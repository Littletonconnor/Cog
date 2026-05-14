# opencode Reference for Building a Minimal Coding Agent

A structured walkthrough of the **opencode** architecture
(`~/oss/opencode`, default branch `dev`), curated for the subset that matters
when building a minimal coding agent from scratch. Citations are file:line
against the repo as it exists today.

> Note on docs: opencode has **no `CLAUDE.md`** and **no `THREAT_MODEL.md`**.
> The security/threat model is documented in `SECURITY.md`. There is an
> `AGENTS.md` at the repo root and per-package (style/conventions). Both are
> used below where relevant.

---

## 1. Repo shape and what you need

opencode is a Bun-first pnpm monorepo. `packages/` contains ~20 packages, but
the **minimal-agent core** lives in five of them:

| Package                | Role                                                                                                            |
| ---------------------- | --------------------------------------------------------------------------------------------------------------- |
| `packages/opencode`    | The actual CLI binary, the agent loop, the tool catalogue, sessions, permissions, the TUI, the HTTP server.     |
| `packages/core`        | Cross-package primitives: schemas, filesystem, npm helpers, global paths, ChildProcess spawner, plugin runtime. |
| `packages/llm`         | A fully self-contained, Effect-Schema-first LLM client (protocols + routes + providers).                        |
| `packages/plugin`      | Plugin/extension type surface — tool definitions, hooks, auth handlers, workspace adapters.                     |
| `packages/ui`          | **Web** UI primitives + Storybook (Vite). Not the TUI.                                                          |

The TUI is **not** a separate Go/Bubble Tea binary. It is a SolidJS app
rendered with `@opentui/solid` running **in the same Bun process** as the
agent (or against a remote server). See §5.

Packages safely ignored for a minimal agent: `desktop`, `slack`, `web`,
`storybook`, `console`, `http-recorder`, `enterprise`, `extensions`,
`function`, `containers`, `identity`, `sdk` (just generated SDK), `script`.

CLI entry: `packages/opencode/src/index.ts:1-251`. yargs dispatches to a long
list of subcommands; the ones that matter:

- `opencode run` — single-shot prompt or interactive direct mode
  (`cli/cmd/run.ts:121`)
- `opencode serve` — headless HTTP server only
  (`cli/cmd/serve.ts:7`)
- `opencode attach <url>` — TUI against a remote server
  (`cli/cmd/tui/attach.ts:9`)
- The bare `opencode` command path runs the TUI via `tui/app.tsx:tui(...)`
  (`cli/cmd/tui/app.tsx:161`)

---

## 2. Operating principle

The minimum mental model is **four layers**, all in-process:

```
┌──────────────────────────────────────────────────────────────────────┐
│                            CLI / TUI / HTTP                          │
│  yargs dispatch       SolidJS+opentui          Effect HttpApi        │
│  (cli/cmd/*)          (cli/cmd/tui)            (server/*)            │
└──────────────────────────────────────────────────────────────────────┘
                                  │
┌─────────────────────────────────▼────────────────────────────────────┐
│                         SessionPrompt loop                           │
│  runLoop() drives one assistant step at a time, asking the           │
│  Processor to handle the LLM stream. Decides "compact / stop /       │
│  continue" each turn.   (session/prompt.ts:1629-1857)                │
└──────────────────────────────────────────────────────────────────────┘
                                  │
┌─────────────────────────────────▼────────────────────────────────────┐
│                       SessionProcessor.process                       │
│  Owns a single LLM stream. Translates AI-SDK events into             │
│  MessageV2 parts (text, reasoning, tool, step). Tracks tool calls,   │
│  doom-loop, snapshots, overflow.  (session/processor.ts:121-816)     │
└──────────────────────────────────────────────────────────────────────┘
                                  │
┌─────────────────────────────────▼────────────────────────────────────┐
│                            LLM.stream                                │
│  Vercel AI SDK streamText() with merged options, plugin-mutable      │
│  params/headers, tool execution, repair hook.                        │
│  (session/llm.ts:75-432)                                             │
└──────────────────────────────────────────────────────────────────────┘
```

State persistence is **SQLite via Drizzle** (`storage/db.ts`, schemas in
`**/*.sql.ts`). Cross-component fan-out is an in-memory **Bus** + a
**SyncEvent** layer that double-writes to DB and Bus
(`bus/index.ts`, `sync/`).

Everything in opencode is built on `effect@v4` — services are
`Context.Service`, state is `Effect.gen`, streams are `Stream`, lifecycle is
`Layer`/`Scope`. `Effect.fn("Domain.method")` wraps every operation for
tracing (`AGENTS.md:84`). Per-project state lives in
`InstanceState`, a `ScopedCache` keyed by directory
(`packages/opencode/AGENTS.md:105-113`).

---

## 3. Agent loop & session model

### 3.1 Sessions are SQLite rows with events

A session is a `SessionTable` row (`session/session.sql.ts`) plus its message
parts in `PartTable`. The schema enforced by Effect Schema is in
`session/session.ts:206-225`:

```ts
export const Info = Schema.Struct({
  id, slug, projectID, workspaceID?, directory, path?, parentID?,
  summary?, cost?, tokens?, share?, title, agent?, model?, version, time,
  permission?, revert?,
})
```

Notable fields:

- `parentID` — child sessions are created by the **task tool**
  (subagents). See `session.ts:543` (`childTitlePrefix = "Child session - "`).
- `revert` — checkpointed `messageID`/`partID`/snapshot/diff used to roll back
  edits (`session.ts:193-198`).
- `summary` (additions/deletions/files/diffs) — running diff totals
  (`session.ts:159-164`).
- `time.compacting` / `time.archived` — lifecycle stamps.

### 3.2 Session APIs

Service interface (`session/session.ts:453-501`):

- `create`, `get`, `list`, `children`, `remove`
- `fork({ sessionID, messageID? })` — clones all messages up to `messageID`
  into a new session with title `"<title> (fork #N)"`
  (`session.ts:145-153, 679-719`). Each part gets a new `PartID.ascending()`;
  `compaction` parts have their `tail_start_id` rewritten through an `idMap`.
- `setTitle`, `setArchived`, `setPermission`, `setRevert`, `clearRevert`,
  `setSummary`, `touch`.
- `messages` paginates 50 at a time backwards from newest (`session.ts:767-786`).
- `findMessage(predicate)` — newest-first scan, also paginated.

All mutations go through `SyncEvent.run(...)`, which writes to the DB and
publishes the event on the Bus. Subscribers (TUI, plugins, server SSE) see
the same stream.

### 3.3 The actual agent loop

The loop is a plain `while (true)` in
`session/prompt.ts:1629-1857` (`runLoop`):

1. Set status `busy`, log step, load all non-compacted messages
   (`MessageV2.filterCompactedEffect`).
2. Find `lastUser`, `lastAssistant`, `lastFinished`, and any pending
   `compaction`/`subtask` parts.
3. **Exit conditions** (`prompt.ts:1669-1677`): break if last assistant has a
   finish reason that isn't `tool-calls`, has no provider-unexecuted tool
   calls, and post-dates the last user message.
4. On first step, fork off a title-generation task (`title(...)` runs the
   `title` hidden agent).
5. Pop the next task: if `subtask` → `handleSubtask`; if `compaction` →
   `compaction.process(...)`.
6. If `lastFinished.tokens` overflows the model → `compaction.create({ auto: true })`,
   continue (the compaction message is appended and picked up next iteration).
7. Build an assistant `MessageV2.Assistant` shell, persist it, create a
   `Processor.Handle` (`prompt.ts:1729-1749`).
8. Resolve tools for this turn (`resolveTools(...)` filters by agent
   permissions, see §4.4), inject system prompts (`environment`,
   `instructions`, `skills`), convert messages to AI SDK `ModelMessage[]`,
   call `handle.process(streamInput)` (`prompt.ts:1797-1817`).
9. `result` is `"continue"` | `"stop"` | `"compact"`. On `compact`, enqueue a
   compaction. On `stop`, break (`prompt.ts:1838-1850`).
10. After the loop: `compaction.prune` runs async; return the last
    assistant message.

`loop(...)` wraps `runLoop` with a `SessionRunState.ensureRunning` mutex so a
session can only be running once (`prompt.ts:1859-1863`,
`session/run-state.ts`).

### 3.4 The processor — one LLM step

`SessionProcessor.create({ assistantMessage, sessionID, model })` returns a
handle whose `process(streamInput)` drives one streamed LLM call
(`session/processor.ts:121-812`). The processor:

- Captures a `snapshot` *before* the stream starts (`processor.ts:124-126`);
  AI SDK may execute tools before emitting `start-step`.
- Consumes `llm.stream(streamInput)` via `Stream.tap(handleEvent)` and
  `Stream.runDrain` (`processor.ts:743-749`).
- `handleEvent` is a giant switch on AI SDK event types
  (`processor.ts:229-643`):
  - `reasoning-start` / `-delta` / `-end` → maintains a `reasoningMap` of
    `ReasoningPart`s, streams deltas via `session.updatePartDelta`.
  - `tool-input-start` → allocates `ToolPart{status:"pending"}`,
    registers a `Deferred` keyed by `toolCallId`.
  - `tool-call` → transitions to `running`, also **doom-loop check**: if the
    last 3 parts are the same tool with identical input, raise a
    `doom_loop` permission request (`processor.ts:370-394`).
  - `tool-result` → marks the part `completed`, optionally captures file
    attachments.
  - `tool-error` → marks `error`; if it's a `Permission.RejectedError`,
    `ctx.blocked = ctx.shouldBreak` (which controls whether deny stops the
    loop; can be inverted via `experimental.continue_loop_on_deny`,
    `processor.ts:737`).
  - `start-step` → records a `step-start` part with the snapshot.
  - `finish-step` → records usage, cost, writes `step-finish`, computes a
    `patch` against the snapshot for the file-diff view, kicks off async
    summarization, and **flips `needsCompaction` if overflow**
    (`processor.ts:506-567`).
  - `text-start` / `-delta` / `-end` → builds the streamed `TextPart`,
    calls plugin hook `experimental.text.complete` at end
    (`processor.ts:608-616`).
- Retries with `SessionRetry.policy(...)` (`session/retry.ts`,
  `processor.ts:763-793`).
- `cleanup` on interrupt: finalize text/reasoning, mark in-flight tools as
  `error: "Tool execution aborted"`, set `assistantMessage.time.completed`.
- Returns: `"compact"` if overflow flagged, `"stop"` if blocked or errored,
  otherwise `"continue"`.

### 3.5 Branching, resumption, compaction

- **Branching** = `Session.fork(...)` (above). All children inherit parent
  permissions; subagents have a `parentID`.
- **Resumption** = re-open a session by ID (`opencode run --session <id>` or
  `--continue` for the most recent root, `cli/cmd/run.ts:362-422`).
- **Compaction** lives in `session/compaction.ts` (655 lines). Key bits:
  - Triggered automatically when `isOverflow({ tokens, model })`
    (`processor.ts:562-565`, `compaction.ts:238-243`).
  - `select(...)` (`compaction.ts:253-302`) picks how many turns to keep
    in the "tail" (default `tail_turns=2`, `MIN_PRESERVE_RECENT_TOKENS=2000`,
    `MAX_PRESERVE_RECENT_TOKENS=8000`, bounded by 25% of usable context).
  - The `compaction` hidden agent runs with a strict markdown
    `SUMMARY_TEMPLATE` (`compaction.ts:43-78`) covering Goal,
    Constraints, Progress (Done/In-Progress/Blocked), Key Decisions,
    Next Steps, Critical Context, Relevant Files.
  - The result is written as a `compaction` part on a synthetic user message;
    subsequent loop iterations skip messages before `tail_start_id` via
    `MessageV2.filterCompactedEffect`.
  - `prune` (background) strips heavy tool outputs (`PRUNE_MINIMUM=20_000`
    chars, `TOOL_OUTPUT_MAX_CHARS=2_000`, `PRUNE_PROTECTED_TOOLS=["skill"]`).

### 3.6 Streaming to the UI

Every part mutation goes through `session.updatePart` /
`session.updatePartDelta` (`session.ts:624-632, 812-820`). Internally:

- `updatePart` calls `sync.run(MessageV2.Event.PartUpdated, ...)` which:
  - INSERTs / UPDATEs `PartTable`
  - publishes on the Bus
- `updatePartDelta` only publishes (`MessageV2.Event.PartDelta`) — no DB
  write per delta, just an event the TUI consumes to append to its local
  text-part buffer.

The HTTP server exposes this as a Server-Sent Events stream at
`GET /api/event` (`server/routes/instance/httpapi/event.ts:19-59`,
`HttpApiSchema.asText({ contentType: "text/event-stream" })`). The TUI
subscribes via `@opencode-ai/sdk` over HTTP
(`cli/cmd/tui/context/sdk.tsx:1-2`).

For **direct interactive mode** (`opencode run --interactive`), the same
in-process Bus is consumed directly by a reducer pipeline in
`cli/cmd/run/runtime.*` and `cli/cmd/run/stream.ts:1-60` that commits to a
"footer" surface and a scrollback writer — no HTTP hop.

---

## 4. Tool system

### 4.1 Tool definition shape

A tool is a single Effect-defined record
(`tool/tool.ts:35-77`):

```ts
interface Def<P, M> {
  id: string
  description: string
  parameters: P                     // Effect Schema
  jsonSchema?: JSONSchema7          // optional override for plugin tools
  execute(args, ctx): Effect.Effect<ExecuteResult<M>>
  formatValidationError?(error): string
}
```

`Tool.define(id, init)` (`tool/tool.ts:132-150`) wraps an init effect, then
each invocation:

- decodes args through the Schema decoder (compiled once per init),
- runs `execute(decoded, ctx)`,
- post-truncates the output via `Truncate.output(...)` unless the tool already
  set `metadata.truncated`,
- wraps the whole thing in an OTel span `Tool.execute`.

The execute context (`tool/tool.ts:16-26`):

```ts
type Context = {
  sessionID, messageID, agent, abort, callID?,
  extra?, messages,
  metadata(input): Effect.Effect<void>,
  ask(input): Effect.Effect<void>     // permission prompt
}
```

`ctx.ask` is the canonical way tools request user approval. `ctx.metadata`
publishes intermediate state (e.g. the shell tool streams live output
through it).

### 4.2 Built-in tool catalogue

The registry (`tool/registry.ts:213-257`) wires up every native tool. In
default order:

| id           | Source                  | Purpose                                                                         |
| ------------ | ----------------------- | ------------------------------------------------------------------------------- |
| `invalid`    | `tool/invalid.ts`       | Placeholder for malformed tool calls (model self-correct).                     |
| `question`   | `tool/question.ts`      | Ask the user a question (only enabled for `app`/`cli`/`desktop` clients).      |
| `bash`       | `tool/shell.ts`         | Shell command execution. See §4.5.                                              |
| `read`       | `tool/read.ts` (342L)   | Read file/dir, 2000-line default, 50KB binary cap, image/PDF attachments.      |
| `glob`       | `tool/glob.ts`          | Pattern-based file matching.                                                    |
| `grep`       | `tool/grep.ts`          | ripgrep wrapper.                                                                |
| `edit`       | `tool/edit.ts` (711L)   | Find/replace edit with strict-match.                                           |
| `write`      | `tool/write.ts`         | Whole-file write.                                                               |
| `task`       | `tool/task.ts`          | Spawn a subagent (creates a child session). See §4.6.                          |
| `webfetch`   | `tool/webfetch.ts`      | HTTP GET with markdown conversion.                                             |
| `todowrite`  | `tool/todo.ts`          | Maintain a per-session TODO list.                                              |
| `websearch`  | `tool/websearch.ts`     | Web search (gated by provider/flag).                                           |
| `repo_clone` | `tool/repo_clone.ts`    | Experimental scout-mode dep cloning.                                            |
| `repo_overview` | `tool/repo_overview.ts` | Experimental.                                                                |
| `skill`      | `tool/skill.ts`         | Load a "skill" — bundled prompt+resources injected mid-session.                |
| `patch`      | `tool/apply_patch.ts`   | OpenAI-style unified-diff patcher (used for GPT-5+ models).                    |
| `lsp`        | `tool/lsp.ts`           | Experimental LSP queries.                                                       |
| `plan`       | `tool/plan.ts`          | Experimental plan-mode exit.                                                    |

Selection logic (`tool/registry.ts:304-349`):

- `websearch` requires `providerID==="opencode"` or `enableExa`/`enableParallel`.
- For GPT-5+ non-OSS GPT models, `apply_patch` is enabled and `edit`/`write`
  are **disabled** (one-or-the-other).
- For every tool: `plugin.trigger("tool.definition", ...)` can mutate the
  description/parameters before they're shipped to the model.
- `task` and `skill` tools get an **appended dynamic description**:
  `describeTask` lists subagents (filtered by current agent's `task`
  permission), `describeSkill` lists available skills via `Skill.fmt`.

### 4.3 Custom & plugin tools

Custom tools come from two places (`tool/registry.ts:188-208`):

1. **Project files**: every `tool/*.{js,ts}` or `tools/*.{js,ts}` in any
   configured directory is dynamically imported as a `file://` URL. Named
   exports become `<filename>_<exportName>` tools; the default export becomes
   `<filename>` (`registry.ts:192-201`).
2. **Loaded plugins**: each `Hooks.tool[id]` from a loaded plugin
   (`plugin/loader.ts`) becomes a tool.

Plugin tools (`@opencode-ai/plugin/tool.ts:46-55`) use **Zod** for params,
not Effect Schema. The registry boxes them at the boundary:
`fromPlugin(...)` (`registry.ts:136-186`) converts the Zod schema to JSON
Schema, replaces parameters with `Schema.Unknown` (validated via
`zodParams.safeParse` inside a `Schema.declare`), then runs the plugin
`execute(args, pluginCtx)` as a `Promise`.

### 4.4 Permissions

Permissions are **UX-only** — they are not a sandbox. See §7.

Schema (`permission/index.ts:19-30`):

```ts
type Action = "allow" | "deny" | "ask"
type Rule = { permission: string, pattern: string, action: Action }
type Ruleset = Rule[]
```

Evaluation (`permission/evaluate.ts:9-15`) does a **right-to-left wildcard
match** across all merged rulesets (last match wins; default is `"ask"`).
Wildcards are glob-style via `util/wildcard`.

Layered rulesets (merged via `Permission.merge`):

1. **Native defaults per agent** — set in `agent/agent.ts:100-119`:
   - `"*": "allow"`, but several "ask" overrides (`doom_loop`, env files,
     `external_directory: *`, etc.).
   - `read` is `"allow"` for `*` but `"ask"` for `*.env` / `*.env.*` (mirrors
     `gitignore`'s Node template).
2. **Agent-specific** — e.g. the `plan` agent forces `edit: "*": "deny"`
   except `.opencode/plans/*.md` (`agent.ts:139-161`).
3. **User config** — `cfg.permission` (`agent.ts:121`).
4. **Session-scoped** — set via `session.setPermission` (e.g. CLI
   `--dangerously-skip-permissions` builds a session ruleset).

`Permission.ask(input)` (`permission/index.ts:161-196`):

- Evaluates each pattern in `input.patterns` against `ruleset` then
  `approved` ("always" replies are persisted in the `PermissionTable` row).
- If **any** pattern is `"deny"` → throw `DeniedError`.
- If all are `"allow"` → return immediately.
- Otherwise create a `Deferred`, publish `Event.Asked` on the bus, wait for a
  `reply` to fulfill or reject it.
- `reply: "always"` appends the patterns to `approved`, retriggers other
  pending requests in the same session that now satisfy the rules
  (`permission/index.ts:240-253`).
- `reply: "reject"` with feedback raises a `CorrectedError` carrying the
  user's message back to the model (so it can adjust).

Disabled tools (`permission/index.ts:293-302`) — if a tool's permission is
literally `pattern: "*", action: "deny"`, it's filtered out **before** being
sent to the LLM (`session/llm.ts:449-455`). Otherwise it's sent and
filtered case-by-case at execute time.

### 4.5 The shell tool (deep dive)

`tool/shell.ts` (631 lines) is the single most security-relevant tool. Key
behaviors:

- **Shell detection**: `Shell.acceptable(cfg.shell)` picks bash/zsh/sh/pwsh
  depending on platform (`shell/shell.ts`). Different prompts for
  bash-likes vs PowerShell (`tool/shell/prompt.ts`).
- **Command parsing with tree-sitter**: bash and PowerShell WASM grammars
  loaded lazily (`shell.ts:308-333`). The tool **parses each command before
  running** to extract referenced paths and command names.
- **Permission scan**: `collect(...)` (`shell.ts:373-409`) walks every
  `command` node, classifies its head verb (`FILES`, `CMD_FILES`, `CWD`,
  PowerShell variants), and:
  - Adds every path argument outside the instance to `scan.dirs` (for the
    `external_directory` permission).
  - Adds the whole command text to `scan.patterns`.
  - Adds the `BashArity.prefix(tokens).join(" ") + " *"` form to
    `scan.always` (so "always allow this prefix" makes sense; e.g.
    `npm run *`).
  - Then `ctx.ask` is called once per `bash` invocation with all collected
    patterns (`shell.ts:280-288`).
- **Execution**: `ChildProcess.make(command, [], { shell, cwd, env, stdin: "ignore", detached })`
  (`shell.ts:300-307`). On Windows under PowerShell it uses
  `-NoLogo -NoProfile -NonInteractive -Command`.
- **Output handling**: streams stdout+stderr (`handle.all`) into a rolling
  ring buffer, capped by `limits.maxBytes` (truncate module). If output
  exceeds the cap, it writes the full output to a file in
  `Global.Path.tmp/*` and tells the model `"...output truncated...\n\nFull
  output saved to: <path>"` (`shell.ts:471-553`).
- **Timeout**: default `2 * 60 * 1000` ms, overridable by
  `OPENCODE_EXPERIMENTAL_BASH_DEFAULT_TIMEOUT_MS` flag
  (`shell.ts:29`). `Effect.raceAll([exitCode, abort, timeout])` — on timeout
  or abort the handle is killed with a 3s `forceKillAfter`.
- **Plugin extension**: `plugin.trigger("shell.env", { cwd, sessionID }, { env })`
  lets plugins inject env vars before each command (`shell.ts:411-421`).

### 4.6 The task tool (subagents)

`tool/task.ts:32-174` — the model spawns a subagent by name:

1. Permission check `permission: "task", patterns: [subagent_type]`.
2. Lookup agent by name; create a child session
   (`parentID: ctx.sessionID`) with a derived permission ruleset
   (`agent/subagent-permissions.ts`).
3. Fetch the parent assistant message, infer the model.
4. Run a full prompt loop on the child session via `ctx.extra.promptOps`
   (`task.ts:121-137`) — this is the **same `SessionPrompt.prompt`** but
   bound to the subagent's tools (task→false, todowrite→false if the
   subagent doesn't have it, etc.).
5. Return the final text part wrapped in `<task_result>` tags, plus the
   `task_id` so the model can resume the subagent with `task_id=<id>`
   (`task.ts:138-152`).

### 4.7 Agent definitions

`Agent.Info` (`agent/agent.ts:28-49`) is the metadata for an agent kind. The
**built-in** agents (`agent.ts:123-275`):

- `build` — default; full default permissions; `mode: "primary"`.
- `plan` — disallows edit tools; `mode: "primary"`.
- `general` — subagent for parallel research; no `todowrite`.
- `explore` — subagent restricted to grep/glob/read/bash/fetch/search;
  separate `PROMPT_EXPLORE`.
- `scout` (experimental flag) — subagent for cloning dep repos.
- `compaction`, `title`, `summary` — hidden primary agents used internally
  for summarization, with `"*": "deny"`.

User-defined agents come from `cfg.agent` (`agent.ts:277-304`) and can
override every field.

---

## 5. TUI

**The TUI is not a separate process and not Go/Bubble Tea.** It is a
**SolidJS app** rendered into the terminal via `@opentui/solid` running in
the same Bun process as everything else. Confirmed by:

- No `go.mod` files in the entire opencode tree.
- `cli/cmd/tui/app.tsx:1` imports `render, useRenderer, useTerminalDimensions`
  from `@opentui/solid`.
- `cli/cmd/tui/app.tsx:6` imports `createCliRenderer, MouseButton` from
  `@opentui/core`.
- `tui(...)` (`app.tsx:161-262`) calls `createCliRenderer(rendererConfig(...))`
  then `render(<App />, renderer)`.

### 5.1 How it talks to the agent

Two modes:

1. **Local in-process** (default `opencode` command): the TUI starts an
   in-process Bun HTTP server on a random port (`Server.listen(...)`,
   `server/server.ts`) and connects to it. The server serves the
   `@opencode-ai/sdk/v2` HTTP API from the same JS context (no IPC).
2. **Remote attach** (`opencode attach <url>`): the TUI hits a remote
   `opencode serve` process over HTTP, authenticated with HTTP Basic
   (`OPENCODE_SERVER_PASSWORD` / `_USERNAME`)
   (`cli/cmd/tui/attach.ts:36-46, 68`).

In both modes the protocol is identical: it's the
`@opencode-ai/sdk/v2.createOpencodeClient(...)` typed client
(`cli/cmd/tui/context/sdk.tsx:1-12`). The HTTP API is defined with
Effect's `HttpApi` (Schema-driven OpenAPI generation,
`server/routes/instance/httpapi/`).

### 5.2 Event streaming

Live events come over **Server-Sent Events** at `GET /api/event`
(`server/routes/instance/httpapi/event.ts:19-59`). The endpoint declares
`success: Schema.String.pipe(HttpApiSchema.asText({ contentType:
"text/event-stream" }))` and bridges the in-process `Bus.subscribeAll()` to
the response stream. The TUI's `SyncProvider` subscribes and reconciles
events into local Solid signals (`cli/cmd/tui/context/sync.tsx`).

### 5.3 Layout & interaction

- `App` (`app.tsx:264+`) sets up theme, keymap, dialogs, command palette,
  prompt history; renders one of two routes (`<Home />` or `<Session />`).
- Bindings registered through `OpencodeKeymapProvider` with the
  `@opentui/keymap` library; commands include `session.list`, `session.new`,
  `model.cycle_recent`, `agent.list`, `theme.switch`, etc.
  (`app.tsx:75-119`).
- Plugin TUIs (`@opencode-ai/plugin` exposes a `tui?` entry,
  `plugin/src/index.ts:79`) can register additional routes through
  `TuiPluginRuntime` (`cli/cmd/tui/plugin/runtime.ts`).

### 5.4 Direct interactive runner (alternative to TUI)

`opencode run --interactive` skips the SolidJS TUI and uses a
**reducer-based footer/scrollback** runner in `cli/cmd/run/`:

- `runtime.boot.ts` resolves keybinds, model variants, session history
  concurrently.
- `runtime.ts` (791 lines), `runtime.lifecycle.ts`, `runtime.queue.ts`,
  `runtime.stdin.ts` implement the interactive loop.
- `stream.ts` and `scrollback.writer.tsx` write streamed events into the
  scrollback. `footer.*.tsx` (Solid components) render the footer (input,
  permission prompts, subagent status, etc.).

This is the same machinery the TUI uses for permission prompts, but rendered
inline above the cursor instead of in a full-screen app.

---

## 6. LLM provider abstraction

opencode has **two distinct LLM stacks** in the tree:

### 6.1 Production stack — Vercel AI SDK directly

`session/llm.ts:75-432` calls `streamText({...})` from the `ai` package.
Providers come from `packages/opencode/src/provider/`:

- `provider.ts` (~1700+ lines) — central provider registry. Loads
  `models.dev` metadata (`provider/models.ts`), merges per-provider config,
  resolves an AI SDK `LanguageModelV3` for each model id.
- `auth.ts` — credential lookup (env vars, oauth flows).
- `transform.ts` — `ProviderTransform.options(...)`,
  `.smallOptions(...)`, `.maxOutputTokens(...)`, `.temperature(...)`,
  `.topP(...)`, `.topK(...)`, `.message(...)` — per-provider adjustments
  before sending. Used heavily inside `session/llm.ts:129-178`.

Built-in provider plugins (auto-merged at startup,
`plugin/index.ts:1-50`): `azure`, `cloudflare`, `codex`, `digitalocean`,
`github-copilot`. These contribute auth flows and model lists.

`session/llm.ts` highlights:

- Merges `base options`, `model options`, `agent options`, and `variant
  options` with `mergeDeep` (`llm.ts:140`).
- Lets `plugin.trigger("chat.params", ...)` and `chat.headers` mutate
  params (`llm.ts:160-192`).
- Calls `resolveTools(input)` to **filter out disabled tools** based on
  agent permission rules and `user.tools` overrides
  (`llm.ts:194, 449-455`).
- **LiteLLM/Bedrock workaround** (`llm.ts:201-226`): if the message history
  contains tool calls but the active toolset is empty (e.g. during
  compaction), injects a `_noop` tool with a "do not call this" description
  so the proxy accepts the request.
- **Tool name repair hook** (`llm.ts:342-362`): if the LLM calls `EDIT` but
  only `edit` is registered, lower-cases it; otherwise rewrites the call
  to the `invalid` tool with the validation error as input.
- `streamText` is wrapped with `wrapLanguageModel` middleware that runs
  `ProviderTransform.message(...)` on every stream-mode call
  (`llm.ts:391-405`).
- A custom branch handles `GitLabWorkflowLanguageModel` —
  GitLab Duo Workspace agents run tools server-side; opencode acts as a
  tool executor over WebSocket (`llm.ts:232-314`).

### 6.2 The standalone `packages/llm` (alternative)

`packages/llm` is a more recent, self-contained, Effect-Schema-first LLM
client (`packages/llm/AGENTS.md`). The architecture has four orthogonal
seams (`AGENTS.md:46-75`):

- **Protocol** — semantic API contract: request body schema, stream event
  schema, event-to-`LLMEvent` state machine. Files:
  `protocols/openai-chat.ts`, `openai-responses.ts`,
  `anthropic-messages.ts`, `gemini.ts`, `bedrock-converse.ts`,
  `openai-compatible-chat.ts`.
- **Endpoint** — URL path construction. `Endpoint.path("/chat/completions")`
  or a function that pulls from the body.
- **Auth** — per-request auth: `Auth.bearer()`,
  `Auth.apiKeyHeader("x-api-key")`, or custom signing for Bedrock SigV4.
- **Framing** — bytes → frames. `Framing.sse` is shared; Bedrock uses
  binary AWS event-stream framing.

Compose via `Route.make({ id, provider, protocol, transport, defaults })`
(`AGENTS.md:54-71`). DeepSeek, TogetherAI, Cerebras, Baseten, Fireworks,
DeepInfra all reuse `OpenAIChat.protocol` — each is a 5-15 line `Route.make`.

Provider helpers live in `providers/`:
`openai-compatible.ts`, `openai-compatible-profile.ts`,
`amazon-bedrock.ts`, `anthropic.ts`, `azure.ts`, `cloudflare.ts`,
`github-copilot.ts`, `google.ts`, `openai.ts`, `openrouter.ts`, `xai.ts`.

Top-level call API (`packages/llm/src/llm.ts:46-81`):

```ts
const req = LLM.request({ model, system, prompt, messages, tools, ... })
const resp = yield* LLM.generate(req)        // collected LLMResponse
const stream = LLM.stream({ request, tools }) // Stream<LLMEvent>
```

`LLM.generate` collects events; `LLM.stream` returns the typed event stream.
Tool runtime (`tool-runtime.ts`) executes typed tools defined with
`tool({ description, parameters, success, execute })`, decoding input
against the `parameters` Schema and encoding result against `success`.

Errors must be `ToolFailure`; everything else is a defect that fails the
stream (`AGENTS.md:219-231`).

**Note for a minimal agent**: if you're building from scratch, the
`packages/llm` design is the cleaner mental model. The opencode binary itself
still uses the Vercel AI SDK directly because the migration to its own LLM
package is incomplete (the `session/llm.ts` path is what actually runs).

---

## 7. Sandboxing & security model

There is **no sandboxing**. From `SECURITY.md:13-19`:

> ### No Sandbox
>
> OpenCode does **not** sandbox the agent. The permission system exists as
> a UX feature to help users stay aware of what actions the agent is taking
> — it prompts for confirmation before executing commands, writing files,
> etc. However, it is not designed to provide security isolation.
>
> If you need true isolation, run OpenCode inside a Docker container or VM.

Out-of-scope per `SECURITY.md:27-33`:

- Server access when opted-in (server mode is the user's responsibility).
- Sandbox escapes.
- LLM provider data handling.
- MCP server behavior.
- Malicious config files.

Practical implications for the permission system:

- `Permission.ask` blocks the agent until the user approves a tool call;
  this is an **honest dialog**, not a security boundary. A malicious tool
  could spawn child processes, hijack the shell, etc.
- The shell tool's tree-sitter parsing is there to *enumerate referenced
  paths so they can be permission-prompted*. It is not validation — the
  command runs through `ChildProcess.make(command, [], { shell, ... })`
  (`tool/shell.ts:300-307`), which passes the entire command string to the
  shell verbatim. A wildcard always-rule like `cat *` will allow `cat
  /etc/passwd`.
- `read` defaults to `*.env: "ask"`, but only matches by *file name*, not
  by path traversal.
- The `external_directory` permission is the only mechanism preventing
  edits/reads outside the project worktree (`agent.ts:90-119,
  shell.ts:373-409`).

If you want a real sandbox in your minimal agent: run the shell tool inside
a Docker container, an ephemeral VM, or a `microsandbox`/`bubblewrap`
namespace. Don't try to recreate the permission system and call it a
sandbox — the explicit upstream warning will hit you eventually.

---

## 8. Plugin & extension model

### 8.1 The plugin contract

`@opencode-ai/plugin` (`packages/plugin/src/index.ts:1-333`) defines the
plugin shape. Each plugin is `(input, options?) => Promise<Hooks>`:

```ts
type Plugin = (input: PluginInput, options?: PluginOptions) => Promise<Hooks>
```

`PluginInput` (`plugin/index.ts:56-67`):

- `client` — a typed SDK client to call back into the running server.
- `project`, `directory`, `worktree`, `serverUrl`.
- `$` — a Bun `BunShell` instance for shelling out.
- `experimental_workspace.register(type, adapter)` — register a workspace
  adapter (local/remote project type).

### 8.2 Hooks (`plugin/index.ts:222-333`)

| Hook                                            | When                                                 |
| ----------------------------------------------- | ---------------------------------------------------- |
| `event(input)`                                  | For every Bus event.                                 |
| `config(input)`                                 | After config load.                                   |
| `tool: { [id]: ToolDefinition }`                | Contributes tools (see §4.3).                        |
| `auth: AuthHook`                                | Custom OAuth/API auth flow for a provider.           |
| `provider: ProviderHook`                        | Provide additional models for a provider.            |
| `chat.message(input, output)`                   | New user message received; can mutate `parts`.       |
| `chat.params(input, output)`                    | Mutate LLM params (temperature, topP, maxTokens, options). |
| `chat.headers(input, output)`                   | Mutate request headers.                              |
| `permission.ask(input, output)`                 | Auto-allow/deny without prompting the user.          |
| `command.execute.before(input, output)`         | Slash-command preprocessing.                         |
| `tool.execute.before(input, output)`            | Mutate tool args before execute.                     |
| `shell.env(input, output)`                      | Inject env vars into bash tool.                      |
| `tool.execute.after(input, output)`             | Mutate tool result (title/output/metadata).          |
| `tool.definition(input, output)`                | Mutate tool description/parameters sent to LLM.      |
| `experimental.chat.messages.transform`          | Bulk-mutate message history before send.             |
| `experimental.chat.system.transform`            | Mutate system prompt array.                          |
| `experimental.session.compacting`               | Inject context / override compaction prompt.         |
| `experimental.compaction.autocontinue`          | Skip the synthetic "continue" after compaction.      |
| `experimental.text.complete`                    | Final post-process of streamed text parts.           |

### 8.3 Plugin loader

`PluginLoader` (`plugin/loader.ts:14-216`) does five things:

1. **Plan**: normalize each config entry into `{ spec, options, deprecated }`.
2. **Resolve target**: for `npm:foo` install it on demand; for `file:./x`
   resolve the local path (`resolvePluginTarget`).
3. **Resolve entrypoint**: `createPluginEntry(spec, target, kind)` looks at
   the package's exports map for a `server` or `tui` entry.
4. **Compatibility check**: for npm plugins only, validate against
   `InstallationVersion` from the plugin's package.json.
5. **Load**: dynamic `import(entry)`. File-based plugins get **one retry
   after** `wait?()` resolves — for local plugins that depend on a build
   step kicking off elsewhere.

Each plugin's `server` export is invoked with `PluginInput`; its returned
`Hooks` are stored. `Plugin.trigger("hook.name", input, output)`
(`opencode/src/plugin/index.ts`) iterates all loaded plugins, calling each
hook in registration order, passing `output` mutably so plugins can compose.

### 8.4 TUI plugins

Plugins can also export a `tui` entry
(`plugin/index.ts:78-80, plugin/tui.ts`). Loaded via the same loader but
with `kind: "tui"`, executed inside `TuiPluginRuntime.init`
(`cli/cmd/tui/plugin/runtime.ts`). They get a `createTuiApi(...)` handle
that lets them register routes, dialogs, commands, and theme entries.

### 8.5 MCP

opencode also supports **MCP servers** as a separate extension layer
(`packages/opencode/src/mcp/`). MCP servers are configured in `cfg.mcp` and
loaded as additional tool sources. The MCP integration includes
`mcp-websearch.ts` (`tool/mcp-websearch.ts`) and a websearch over MCP.
For a minimal agent, you can defer MCP — but it's the standard model for
"bring your own tools".

---

## 9. Recommended minimal-agent slice

If you're rebuilding the smallest possible version of opencode, this is the
critical-path code you'll mirror:

1. **Tool definition**: `tool/tool.ts` (the `Def`/`Context`/`ExecuteResult`
   shape — 164 lines, basically a typeclass).
2. **Tool catalogue (5 tools)**: `read`, `write`, `edit`, `bash`/`shell`,
   `grep`. Skip `task`, `skill`, `patch`, `lsp`, `plan` initially.
3. **Permission system**: `permission/index.ts` + `permission/evaluate.ts`
   are ~320 lines and self-contained. Worth porting wholesale.
4. **Agent loop**: copy the `runLoop` in `session/prompt.ts:1629-1857` —
   the meat is the `while (true)` + processor + compaction trigger.
5. **Processor**: `session/processor.ts` translates Vercel AI SDK
   `fullStream` events into structured message parts. ~830 lines, mostly the
   `handleEvent` switch.
6. **LLM call**: a stripped `session/llm.ts` — Vercel `streamText` with your
   provider of choice. Drop the GitLab workflow branch and the LiteLLM
   workaround for v1.
7. **Streaming UI**: for a minimal CLI, the `cli/cmd/run/scrollback.*` +
   `stream.ts` reducer approach is simpler than the full Solid TUI.
   Subscribe to the Bus / process events directly; no HTTP server needed.
8. **Persistence**: optional. For v1 you can keep sessions in-memory; for
   resumption add a single SQLite table mirroring `SessionTable` +
   `PartTable`.

**What to leave out for v1**:

- The HTTP server + SDK roundtrip (everything runs in-process).
- The full SolidJS TUI (use scrollback writer instead).
- Compaction (cap context, fail loudly when over).
- Branching/forking, snapshots, diffs, revert.
- Plugin loader (start with hard-coded tools).
- The standalone `packages/llm` — defer until you outgrow Vercel AI SDK.
- MCP, skills, workspaces.

---

## 10. Open questions & gotchas

- **Effect v4 beta**: `Effect.fork` and `Effect.forkDaemon` don't exist;
  use `Effect.forkIn(scope)` (`packages/opencode/AGENTS.md:114-117`).
  If you're not on Effect, the loop translates fine to plain async/await —
  the Stream → reducer translation is the only piece that's load-bearing.
- **`InstanceState`** is keyed by directory; it's how opencode multi-tenants
  one process across several open project directories. For a single-project
  CLI you don't need it.
- **The default branch is `dev`, not `main`**
  (`AGENTS.md:3-4`). Local `main` may not exist.
- **Bun-only** runtime: opencode uses `Bun.file`, `Bun.stdin`, the Bun
  process APIs. The `packages/llm` package uses Effect's HTTP client so it's
  portable; the rest assumes Bun.
- **Doom-loop check** (`processor.ts:370-394`): if the model calls the same
  tool with identical input 3× in a row, opencode raises a `doom_loop`
  permission prompt. Trivial to copy and worth it.
- **Permission "ask" is the default** when no rule matches
  (`permission/evaluate.ts:14`). This is intentional; safer to surface a
  prompt than to silently allow.
- **Tool output truncation** is per-agent (`Truncate.output(...)` in
  `tool/tool.ts:115-125`) — large outputs go to a tmp file and only a head
  is returned to the model. Without this, single shell commands can blow
  the context window.

---

## Index of key files

| Concern              | File                                                                | Lines |
| -------------------- | ------------------------------------------------------------------- | ----- |
| CLI entry            | `packages/opencode/src/index.ts`                                    | 251   |
| `run` command        | `packages/opencode/src/cli/cmd/run.ts`                              | 835   |
| Direct interactive   | `packages/opencode/src/cli/cmd/run/runtime.ts`                      | 791   |
| TUI app              | `packages/opencode/src/cli/cmd/tui/app.tsx`                         | ~700  |
| HTTP server          | `packages/opencode/src/server/server.ts` + `server/routes/instance/httpapi/` | varies |
| SSE event endpoint   | `packages/opencode/src/server/routes/instance/httpapi/event.ts`     | ~60   |
| Bus                  | `packages/opencode/src/bus/index.ts`                                | ~120  |
| Session shape        | `packages/opencode/src/session/session.ts`                          | 994   |
| Agent loop           | `packages/opencode/src/session/prompt.ts` (`runLoop` at 1629)       | 2138  |
| Per-step processor   | `packages/opencode/src/session/processor.ts`                        | 836   |
| LLM call             | `packages/opencode/src/session/llm.ts`                              | 469   |
| System prompts       | `packages/opencode/src/session/system.ts` + `session/prompt/*.txt`  | 84    |
| Compaction           | `packages/opencode/src/session/compaction.ts`                       | 655   |
| Tool def shape       | `packages/opencode/src/tool/tool.ts`                                | 164   |
| Tool registry        | `packages/opencode/src/tool/registry.ts`                            | 431   |
| Bash tool            | `packages/opencode/src/tool/shell.ts`                               | 631   |
| Read tool            | `packages/opencode/src/tool/read.ts`                                | 342   |
| Edit tool            | `packages/opencode/src/tool/edit.ts`                                | 711   |
| Task (subagent) tool | `packages/opencode/src/tool/task.ts`                                | 174   |
| Permission system    | `packages/opencode/src/permission/index.ts`                         | 306   |
| Permission eval      | `packages/opencode/src/permission/evaluate.ts`                      | 15    |
| Agent registry       | `packages/opencode/src/agent/agent.ts`                              | 460   |
| Plugin types         | `packages/plugin/src/index.ts`                                      | 333   |
| Plugin tool helper   | `packages/plugin/src/tool.ts`                                       | 55    |
| Plugin loader        | `packages/opencode/src/plugin/loader.ts`                            | 216   |
| `llm` package        | `packages/llm/src/llm.ts`, `route/`, `protocols/`, `providers/`     | many  |
| Security policy      | `SECURITY.md`                                                       | 47    |
| Conventions          | `AGENTS.md`, `packages/opencode/AGENTS.md`, `packages/llm/AGENTS.md` | varies |
