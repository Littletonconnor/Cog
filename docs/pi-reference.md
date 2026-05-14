# pi Coding Agent — Architecture Reference

A study of the [pi-mono](https://github.com/earendil-works/pi-mono) coding agent at
`/Users/connorlittleton/oss/pi`, written as a build guide for Cog. Focuses on the
mechanics you would need to replicate: the agent loop, tool dispatch, streaming
contract, session/state model, multi-provider LLM layer, and differential-rendering TUI.

Citations use `file:line` against the cloned repo.

---

## 1. Repo layout at a glance

```
packages/
  ai/            multi-provider LLM SDK (no agent logic)
  agent/         core Agent + AgentHarness (LLM-agnostic agent runtime)
  coding-agent/  CLI binary `pi` (interactive/print/json/rpc modes, tools, sessions)
  tui/           differential-rendering terminal UI
  web-ui/        (out of scope)
```

Each package is independently published (`@earendil-works/pi-ai`,
`pi-agent-core`, `pi-coding-agent`, `pi-tui`) and lockstep-versioned
(`AGENTS.md:178`). Build is plain TypeScript via `tsgo`, no bundler.

Line counts (src only, excluding generated models file):

| Package      | TS LOC  | Big files                                                |
| ------------ | ------- | -------------------------------------------------------- |
| `ai`         | ~5k     | `providers/anthropic.ts` 1207, `providers/openai-completions.ts` 1148 |
| `agent`      | ~4.3k   | `harness/agent-harness.ts` 816, `agent-loop.ts` 718, `agent.ts` 553 |
| `coding-agent` | ~17k   | `core/agent-session.ts` 3110, `core/session-manager.ts` 1424, `core/tools/*` ~3.9k |
| `tui`        | ~10k    | `tui.ts` 1319, `keys.ts` 1400, `components/editor.ts` 2292, `components/markdown.ts` 797 |

Key insight: **the agent runtime is small (~4k LOC)**. The TUI, the
coding-agent shell, and the multi-provider SDK each dwarf it. A minimal Cog
clone can start by porting `packages/agent/src/{types.ts,agent-loop.ts,agent.ts}`
(~1.7k LOC including comments) and gluing in a single provider.

---

## 2. Agent loop

### 2.1 The two-layer model

pi splits "agent" into two layers, with explicit names:

1. **Low-level loop** (`packages/agent/src/agent-loop.ts:31` `agentLoop`,
   `agent-loop.ts:95` `runAgentLoop`) — pure functions that drive
   `prompt -> stream -> tool dispatch -> turn end` until terminated. Hooks
   are passed via `AgentLoopConfig`.
2. **Stateful wrapper** `Agent` class (`packages/agent/src/agent.ts:162`) —
   owns the transcript, exposes `prompt()`/`continue()`/`abort()`,
   maintains pending tool calls, runs lifecycle subscribers.

A third layer, `AgentHarness` (`packages/agent/src/harness/agent-harness.ts:119`),
wraps `Agent` with session persistence, skills/prompt templates, compaction,
and a richer hook API. The coding-agent does NOT use `AgentHarness` — it
implements its own equivalent (`AgentSession`) directly on top of `Agent`
(`packages/coding-agent/src/core/agent-session.ts`). `AgentHarness` is what
SDK users get.

### 2.2 Message/turn model

A "turn" = one assistant response plus the tool results it triggered. The
loop's outer iteration is "agent run = many turns". Lifecycle events
(`packages/agent/src/types.ts:395`):

```
agent_start
  turn_start
    message_start (user prompt)
    message_end
    message_start (streamed assistant, partial)
      message_update (deltas while streaming)
    message_end (final assistant)
    tool_execution_start
      tool_execution_update (optional, throttled partial progress)
    tool_execution_end
    message_start (tool result)
    message_end
  turn_end
  (... more turns ...)
agent_end
```

`message_update` carries the entire partial `AssistantMessage` snapshot plus
the raw `AssistantMessageEvent` (`agent-loop.ts:336`); subscribers usually
ignore the snapshot and switch on `event.assistantMessageEvent.type` to drive
streaming UI. The `partial` field is **the entire message-in-progress, not a
delta** — the provider has already accumulated it.

### 2.3 Loop control flow

`runLoop` (`agent-loop.ts:155`) is two nested whiles:

- **Outer loop**: continues iff `getFollowUpMessages()` yields more work.
- **Inner loop**: continues while `hasMoreToolCalls` is true OR there are
  steering messages queued.

Per inner iteration:

1. Inject `pendingMessages` into the context (drained from `getSteeringMessages()`)
   (`agent-loop.ts:182`).
2. Call `streamAssistantResponse(...)` (`agent-loop.ts:275`) which:
   - Optionally calls `transformContext(messages)` (for compaction injection,
     pruning) (`agent-loop.ts:284`).
   - Calls `convertToLlm(messages)` to lower `AgentMessage[]` to LLM-native
     `Message[]` (`agent-loop.ts:289`). This is where custom message types
     (bash-execution, branchSummary, compactionSummary, custom) get folded
     into user messages or dropped.
   - Resolves API key dynamically via `getApiKey(provider)` for short-lived
     OAuth (`agent-loop.ts:302`).
   - Invokes `streamFn(model, context, opts)` and emits `message_*` events
     while iterating the resulting `AssistantMessageEventStream`.
3. If stop reason is `"error"`/`"aborted"`, emit `turn_end` and `agent_end`
   then return (`agent-loop.ts:196`).
4. Otherwise filter `content` for `toolCall` blocks, call
   `executeToolCalls(...)` (`agent-loop.ts:373`), append all
   `ToolResultMessage`s to the context.
5. `prepareNextTurn?.(...)` can swap model / thinkingLevel / context
   atomically before the next turn (`agent-loop.ts:226`). This is how the
   harness applies model switches mid-run.
6. `shouldStopAfterTurn?.(...)` (`agent-loop.ts:242`) — return true to bail
   gracefully (e.g. context-window pressure).
7. Drain new steering queue.

Tool batches can also terminate the loop early: every finalized tool result
must set `result.terminate === true` (`agent-loop.ts:534`). One non-terminating
tool keeps the loop going.

### 2.4 Tool execution modes

`toolExecution: "parallel" | "sequential"` (default `"parallel"`)
(`agent.ts:214`). Per-tool override via `AgentTool.executionMode`
(`types.ts:374`). If any tool in a batch is marked sequential, the whole
batch falls back to sequential dispatch (`agent-loop.ts:381`).

- Sequential (`executeToolCallsSequential`, `agent-loop.ts:395`): one tool at
  a time; `tool_execution_end` and the corresponding tool-result `message_*`
  events are interleaved.
- Parallel (`executeToolCallsParallel`, `agent-loop.ts:447`): all tools
  validated/prepared sequentially (so `beforeToolCall` blocks honor source
  order), then executed via `Promise.all`. `tool_execution_end` events fire
  in completion order, but tool-result messages are appended in source order
  to preserve a deterministic transcript.

Each tool call goes through:

1. `prepareToolCall` (`agent-loop.ts:552`): find tool by name → optional
   `prepareArguments` shim → `validateToolArguments` (typebox) →
   `beforeToolCall` hook (`block: true` shortcuts with an error tool result).
2. `executePreparedToolCall` (`agent-loop.ts:604`): invoke
   `tool.execute(id, args, signal, onUpdate)`. `onUpdate` synchronously
   pushes `tool_execution_update` events that are awaited before the result
   is finalized (`agent-loop.ts:609-633`). Tools that want partial output
   call `onUpdate({ content, details })` to stream into the UI without
   ending the tool call.
3. `finalizeExecutedToolCall` (`agent-loop.ts:641`): `afterToolCall` hook
   can rewrite `content/details/isError/terminate` field-by-field
   (`types.ts:64`, no deep merge).

Errors thrown by `tool.execute` are caught and converted to error tool
results with the error message as text (`agent-loop.ts:632-639`). Tools
should NOT encode errors in their `content` — they should throw
(`types.ts:362`).

### 2.5 Steering vs follow-up vs nextTurn queues

Three semantically distinct queues, all message-typed:

- **Steering** (`agent.ts:260` `Agent.steer`): inject between the current
  turn and the next LLM call. Drained by `getSteeringMessages()` after each
  `turn_end`.
- **Follow-up** (`agent.ts:265` `Agent.followUp`): only injected after the
  agent would otherwise terminate (no more tool calls + no steering). Lets
  users queue "after you're done, do X" messages.
- **NextTurn** (harness-level only,
  `harness/agent-harness.ts:521`): user messages to be prepended to the next
  `prompt()`/`skill()`/template call. Different from steering because the
  agent is **idle** when these are queued.

Each queue supports two modes (`QueueMode = "all" | "one-at-a-time"`,
`agent.ts:56`). Default is `"one-at-a-time"` — drain one message per poll
so the agent can react before the next is injected.

### 2.6 Abort semantics

`Agent.abort()` (`agent.ts:296`) aborts the current `AbortController`. The
loop and providers receive the same signal. On abort:

- `streamFn` is responsible for ending the stream with an error message
  whose `stopReason: "aborted"` and `errorMessage` is set
  (`types.ts:25` — provider contract).
- Tool `execute` callbacks receive the same signal and should bail.
- The loop emits `turn_end` + `agent_end` with the partial transcript.

The `Agent` class additionally has a `handleRunFailure` path
(`agent.ts:472`) that synthesizes an error/aborted assistant message if the
loop itself throws — defensive against bugs in `convertToLlm` etc.

### 2.7 What you need to copy

If Cog ports just `types.ts`, `agent-loop.ts`, and `agent.ts`, you get:
- a streaming-aware loop,
- parallel/sequential tool dispatch,
- before/after tool hooks,
- abort,
- queueing,
- model/thinking swaps mid-run.

You can skip `harness/` entirely until you want compaction and sessions.

---

## 3. Tool calling

### 3.1 Tool definition

`AgentTool<TParameters extends TSchema>` (`packages/agent/src/types.ts:353`):

```ts
interface AgentTool<TParameters, TDetails> extends Tool<TParameters> {
  // Tool base (from pi-ai):
  name: string;
  description: string;
  parameters: TParameters;          // typebox JSON-schema-ish
  // AgentTool additions:
  label: string;                    // display label
  prepareArguments?(args): Static<TParameters>;  // legacy arg shim
  execute(toolCallId, params, signal?, onUpdate?): Promise<AgentToolResult<TDetails>>;
  executionMode?: "sequential" | "parallel";
}
```

`AgentToolResult<T>` (`types.ts:337`) carries:
- `content: (TextContent | ImageContent)[]` — what the model sees
- `details: T` — opaque blob for renderers/log replay (e.g.
  `ReadToolDetails` includes `truncation` info,
  `BashToolDetails` includes `fullOutputPath` for spilled output)
- `terminate?: boolean`

### 3.2 Schema via typebox

Tools use [typebox](https://github.com/sinclairzx81/typebox) — JSON Schema
in TypeScript. The schema is sent verbatim to providers as the tool's
`parameters`. Validation happens in `validateToolArguments` (re-exported from
`pi-ai`) before `execute` is called (`agent-loop.ts:570`).

Example (`packages/coding-agent/src/core/tools/read.ts:20`):

```ts
const readSchema = Type.Object({
  path: Type.String({ description: "Path to the file to read (relative or absolute)" }),
  offset: Type.Optional(Type.Number({ description: "Line number to start reading from (1-indexed)" })),
  limit: Type.Optional(Type.Number({ description: "Maximum number of lines to read" })),
});
export type ReadToolInput = Static<typeof readSchema>;
```

### 3.3 Default tool set

The coding-agent ships **7 tools** (`packages/coding-agent/src/core/tools/index.ts:83`):

| Tool   | File                                                  | LOC |
| ------ | ----------------------------------------------------- | --- |
| `read` | `tools/read.ts`                                       | 363 |
| `bash` | `tools/bash.ts`                                       | 440 |
| `edit` | `tools/edit.ts` (+ `edit-diff.ts` 446)                | 489 |
| `write`| `tools/write.ts`                                      | 281 |
| `grep` | `tools/grep.ts` (uses ripgrep)                        | 384 |
| `find` | `tools/find.ts`                                       | 370 |
| `ls`   | `tools/ls.ts`                                         | 229 |

Default "active" set in interactive mode is **read/bash/edit/write**
(`sdk.ts:271`). `grep/find/ls` exist for environments where you want to
restrict bash. There's a `createReadOnlyTools(cwd)` helper for sandboxed
modes (`tools/index.ts:177`).

Each tool is wrapped by `wrapToolDefinition` (`tools/tool-definition-wrapper.ts`)
which adapts `ToolDefinition` (the extension-friendly object with renderers
and metadata) to `AgentTool` (the runtime contract).

### 3.4 Tool operations injection

Tools take an `operations` option that lets you swap the filesystem/shell
backend. From `read.ts:43-56`:

```ts
export interface ReadOperations {
  readFile: (path) => Promise<Buffer>;
  access: (path) => Promise<void>;
  detectImageMimeType?: (path) => Promise<string | null>;
}
const defaultReadOperations: ReadOperations = {
  readFile: (path) => fsReadFile(path),
  access: (path) => fsAccess(path, constants.R_OK),
  detectImageMimeType: detectSupportedImageMimeTypeFromFile,
};
```

Bash uses the same pattern (`tools/bash.ts:39` `BashOperations`,
`tools/bash.ts:65` `createLocalBashOperations`). This is how pi's
remote-execution extensions (SSH, Docker) plug in without forking the tool
implementations.

### 3.5 Tool execution rendering

Each tool definition exposes `renderCall(args, theme, context)` and
`renderResult(result, options, theme, context)` returning a TUI
`Component`. These run on every `message_update` for in-flight tool calls.
`context.lastComponent` lets the renderer mutate the previous frame in place
(no GC churn). For bash that means it can keep a single
`BashResultRenderComponent` and just call `setText` (`tools/bash.ts:168`).

### 3.6 Output truncation and "details"

Read/bash both use `truncateHead` / `OutputAccumulator`
(`tools/truncate.ts`, `tools/output-accumulator.ts`). The pattern: keep the
last N bytes/lines for context, spill the full output to a temp file, and
include `[Showing lines X-Y of Z. Full output: /tmp/.../bash-output-...txt]`
as a continuation hint. The `truncation` and `fullOutputPath` go into
`details` so the UI can offer "show more" without re-running.

### 3.7 What you need to copy

For a minimal Cog you only need 4 tools: `read`, `write`, `bash`, `edit`.
The edit tool is the most complex — pi's `edit.ts:489` + `edit-diff.ts:446`
implements anchor-based string replacement with leading-whitespace
heuristics. Cog can start with a much simpler "replace first match" or even
"full-file write" only.

---

## 4. Streaming

### 4.1 The two-protocol design

There are **two event streams**:

1. **`AssistantMessageEventStream`** (`packages/ai/src/utils/event-stream.ts:68`)
   — provider-level event protocol for one assistant message. Events:
   `start | text_start | text_delta | text_end | thinking_* | toolcall_* | done | error`
   (`packages/ai/src/types.ts:347`). Every event but `start` carries the
   full `partial: AssistantMessage` snapshot. Providers emit `done` (success)
   or `error` (failure) exactly once.
2. **`AgentEvent`** stream (`packages/agent/src/types.ts:395`) — the
   higher-level lifecycle described in §2.2. Built from `AgentMessageEvent`s by
   `streamAssistantResponse` in the agent loop.

`AssistantMessageEventStream` extends a generic `EventStream<T, R>` queue
(`event-stream.ts:4`) — async-iterable with a queue and a "final result"
promise that resolves on the completing event. The completion predicate is
`event.type === "done" || event.type === "error"`. Same generic is used for
`AgentEvent` (`agent-loop.ts:145`).

### 4.2 Provider responsibilities

The streaming contract (`packages/agent/src/types.ts:18-26`) says:

> Must not throw or return a rejected promise for request/model/runtime
> failures. Must return an `AssistantMessageEventStream`. Failures must be
> encoded in the returned stream via protocol events and a final
> `AssistantMessage` with `stopReason` "error" or "aborted" and
> `errorMessage`.

This is critical: a provider that throws synchronously breaks the loop. The
lazy provider loader enforces this — if the dynamic import itself fails,
`createLazyLoadErrorMessage` builds an error-shaped AssistantMessage and
emits a synthetic `error` event before ending the stream
(`providers/register-builtins.ts:159-178`).

### 4.3 Provider implementation pattern

Each provider exports two functions (`packages/ai/src/api-registry.ts:23`):

```ts
interface ApiProvider<TApi, TOptions> {
  api: TApi;
  stream: StreamFunction<TApi, TOptions>;           // provider-specific options
  streamSimple: StreamFunction<TApi, SimpleStreamOptions>; // unified options
}
```

`streamSimple` is the agent-loop entry point; it maps the unified
`reasoning: ThinkingLevel` knob to provider-specific thinking config and
delegates to `stream`. For Anthropic see
`packages/ai/src/providers/anthropic.ts:728` `streamSimpleAnthropic` and
`anthropic.ts:428` `streamAnthropic`. The latter:

1. Builds a request body with `buildParams(...)` (`anthropic.ts:883`).
2. Calls `client.messages.create({...}).asResponse()` to get the raw
   `Response` (`anthropic.ts:498`).
3. Iterates SSE messages (`iterateSseMessages` / `iterateAnthropicEvents`,
   `anthropic.ts:328` / `anthropic.ts:387`) — pi has its own SSE parser
   rather than letting the SDK iterate, so it can control buffering and
   error semantics.
4. For each event, mutates a running `output: AssistantMessage`, pushes a
   typed `AssistantMessageEvent` onto the `AssistantMessageEventStream`.

`onPayload` and `onResponse` hooks fire before send and after headers
(`anthropic.ts:489-499`, hooked into `AgentLoopConfig` via the same names).
These are how extensions log/modify provider traffic.

### 4.4 Streaming → AgentEvent bridge

In `streamAssistantResponse` (`packages/agent/src/agent-loop.ts:275-368`):

- On `start`: push the partial message into context, emit
  `message_start` with a clone.
- On `text_*` / `thinking_*` / `toolcall_*`: replace
  `context.messages[last]` with `event.partial`, emit `message_update`
  carrying `assistantMessageEvent: event` so the UI can route per-delta.
- On `done` / `error`: replace partial with `await response.result()` (the
  final, validated message), emit `message_end`, return.

The trick that lets the UI render mid-stream is that
**`partial.content` is mutated in place by the provider as deltas arrive**,
and the agent passes a shallow clone (`{ ...partialMessage }`) in events so
subscribers can pick the latest content per render frame without races.

### 4.5 Render-side handling

The TUI doesn't subscribe directly. Coding-agent's `AgentSession`
re-emits agent events to its own listeners via
`_handleAgentEvent` → `_emit` (`packages/coding-agent/src/core/agent-session.ts:453-527`).
Interactive mode subscribes via
`session.subscribe(event => ...)` (`interactive-mode.ts:2619`). On
`message_update` it identifies the message component by id and calls
`setMessage(latestPartial)`, which retriggers `render(width)` on the next
TUI tick (16ms throttle, `tui.ts:253`).

---

## 5. State / session

### 5.1 In-memory transcript

`Agent.state` is exposed as `AgentState` (`packages/agent/src/types.ts:309`).
Notable design choice: `tools` and `messages` are accessor properties that
**copy on assignment** (`agent.ts:78-86`). So `agent.state.messages = newArr`
is a defensive shallow clone, and mutating `state.messages` directly via
`push` works but is not the recommended path.

`AgentMessage = Message | CustomAgentMessages[keyof CustomAgentMessages]`
(`types.ts:301`). The custom branch uses **declaration merging** so apps add
new message types. The coding agent adds `bashExecution`, `custom`,
`branchSummary`, `compactionSummary` via
`harness/messages.ts:54-61`. These never go to the LLM directly; they go
through `convertToLlm` (`harness/messages.ts:120-164`) which collapses them
to user messages with `<summary>...</summary>` tags or drops them.

### 5.2 Persistence: JSONL session files

`Session` (`packages/agent/src/harness/session/session.ts:77`) wraps a
pluggable `SessionStorage`. The default storage is JSONL:
`packages/agent/src/harness/session/repo/jsonl.ts:27` `JsonlSessionRepo`.
Files live at:

```
<sessions-root>/--<cwd-encoded>--/<iso-timestamp>_<session-id>.jsonl
```

Each line is one `SessionTreeEntry` (`types.ts:241`). Tagged union of:
- `message` — user/assistant/toolResult/custom
- `model_change` / `thinking_level_change` — pure metadata events
- `compaction` — summarization milestone with `firstKeptEntryId`
- `branch_summary` — captures a branch you navigated away from
- `custom` / `custom_message` — extension-defined
- `label` / `session_info` — labels and session names

Each entry has `id`, `parentId`, `timestamp` — making the session a **tree**,
not a list. `Session.moveTo(entryId, summary?)` (`session.ts:231`) switches
the leaf, optionally inserting a `branch_summary` of the abandoned branch.
`buildSessionContext` (`session.ts:20-75`) walks root→leaf and re-derives the
linear `AgentMessage[]` for the loop, applying any compaction window.

The coding agent has its own `SessionManager`
(`packages/coding-agent/src/core/session-manager.ts`, 1424 LOC) that doesn't
use `agent/harness/session` — it implements the same JSONL+tree idea
directly, with a richer header and bash-execution support.

### 5.3 Compaction

`packages/agent/src/harness/compaction/compaction.ts` (854 LOC) is a
pure-function library. The flow:

1. `shouldCompact(usage.totalTokens, model.contextWindow, settings)`
   (`compaction.ts:226`) — true when `tokens > contextWindow - reserveTokens`
   (default reserve 16k, default keepRecent 20k,
   `compaction.ts:128-132`).
2. `prepareCompaction(branchEntries, settings)` — find the cut point. Token
   count uses native `usage.totalTokens` from the last assistant message
   when available; otherwise a chars/4 heuristic
   (`compaction.ts:142-297`).
3. `findCutPoint` (`compaction.ts:393`) walks backward from newest entries
   summing estimated tokens, stops at the first **valid cut point** that
   pushes accumulated tokens past `keepRecentTokens`. Valid cut points are
   user/assistant/custom/bashExecution/summary entries — never tool results
   (they must stay glued to their tool call).
4. `compact(...)` (later in file) generates the summary via
   `completeSimple(model, context, ...)` using a structured Markdown
   prompt (`SUMMARIZATION_PROMPT` in `compaction.ts:461-492`). If a prior
   compaction exists it uses an `UPDATE_SUMMARIZATION_PROMPT` that preserves
   existing items and merges new progress.
5. `Session.appendCompaction(summary, firstKeptEntryId, tokensBefore, details)`
   writes a `compaction` entry. On next `buildContext`, the entry slots in a
   `compactionSummary` pseudo-message before `firstKeptEntryId`
   (`session.ts:56-67`).

A `branch_summary` is a sibling concept: when the user picks an older entry
in the tree and "summarizes the abandoned branch into the current one"
(`harness/agent-harness.ts:584` `navigateTree`).

### 5.4 What you need to copy

For Cog v1, **skip the session tree**. Just persist the linear transcript as
JSONL on every `message_end`, restore it via array load on startup. Compaction
can be a single function call: when tokens exceed a threshold, summarize
"messages[0..cut]" and replace them with one synthetic user message. The pi
algorithm in `compaction.ts` is ~200 LOC of substantive code (rest is types
and prompts) and worth copying when needed.

---

## 6. Multi-provider LLM layer (`pi-ai`)

### 6.1 The `Api` registry

The fundamental abstraction is not "provider" but "**API surface**"
(`packages/ai/src/types.ts:6-15`):

```ts
type KnownApi =
  | "openai-completions"
  | "mistral-conversations"
  | "openai-responses"
  | "azure-openai-responses"
  | "openai-codex-responses"
  | "anthropic-messages"
  | "bedrock-converse-stream"
  | "google-generative-ai"
  | "google-vertex";
```

Many "providers" (deepseek, openrouter, groq, cerebras, xai, github-copilot,
etc.) share an API. A `Model<Api>` (`types.ts:528`) carries
`{ id, name, api, provider, baseUrl, reasoning, input, cost, contextWindow,
maxTokens, compat?, ... }`. Each model points to **one** API implementation;
the provider is just metadata + auth selector. This is why there are 30+
providers but only 9 API impls.

The registry (`packages/ai/src/api-registry.ts:40`) is a `Map<api, provider>`
keyed by API name. `registerApiProvider({ api, stream, streamSimple })`
adds an entry. `stream(model, ...)` looks up
`registry.get(model.api).stream(...)` (`packages/ai/src/stream.ts:25-32`).

### 6.2 Lazy provider loading

`providers/register-builtins.ts` (404 LOC) is purely **stub registration**.
It declares a stub `stream` and `streamSimple` for each API that, on first
call, dynamic-imports the real provider module
(`register-builtins.ts:159-201` `createLazyStream` /
`createLazySimpleStream`). Provider impls each pull in heavy SDKs
(`@anthropic-ai/sdk`, `openai`, `@google/genai`, `@aws-sdk/client-bedrock-runtime`,
`@mistralai/mistralai`), and lazy loading keeps cold-start small —
relevant for the `bun build --compile` binary path
(`coding-agent/package.json:34`).

### 6.3 Per-provider compat overlays

The `OpenAICompletionsCompat` interface (`types.ts:365-400`) and friends are
how pi keeps a single API impl while supporting dozens of OpenAI-compatible
endpoints with quirky differences (whether `store` is allowed, whether
`developer` role is supported, how reasoning effort is configured per
provider, whether `cache_control` is supported on tools, etc.). Each model
in `models.generated.ts` carries a `compat` blob; the provider impl reads it
to decide which fields to send (`anthropic.ts:167` `getAnthropicCompat`).

### 6.4 Models registry

`models.generated.ts` is **17252 lines** of auto-generated data, refreshed
by `scripts/generate-models.ts` (`AGENTS.md:151`). Not hand-maintained —
fetches from each provider's catalog API. For Cog you can replace this with a
small hand-written constant per provider you support.

### 6.5 Unified options vs provider options

`StreamOptions` (`types.ts:84`) is the common base — `temperature`,
`maxTokens`, `signal`, `apiKey`, `transport`, `cacheRetention`, `sessionId`,
`onPayload`, `onResponse`, `headers`, `timeoutMs`, `maxRetries`,
`maxRetryDelayMs`, `metadata`. `SimpleStreamOptions` adds `reasoning:
ThinkingLevel` and `thinkingBudgets`. Provider-specific options extend with
e.g. `AnthropicOptions { thinkingEnabled, thinkingBudgetTokens, effort, ... }`
(`anthropic.ts:181`).

`streamSimple` is the bridge: it maps `reasoning` to provider-specific
thinking config and delegates. `buildBaseOptions` (`providers/simple-options.ts:3`)
clamps `maxTokens` to `min(model.maxTokens, 32000)` if unspecified.
`adjustMaxTokensForThinking` (`simple-options.ts:26`) reserves budget tokens
for thinking-capable models using a per-level budget map.

### 6.6 Auth detection

`packages/ai/src/env-api-keys.ts:91` maps each provider to an ordered list
of env vars (`ANTHROPIC_OAUTH_TOKEN`, then `ANTHROPIC_API_KEY`, etc.). The
provider calls `getEnvApiKey(provider)` at request time as a fallback when
no `apiKey` was passed (`anthropic.ts:733`). The coding-agent layers its
own `AuthStorage` (`packages/coding-agent/src/core/auth-storage.ts`, 524
LOC) which persists OAuth tokens and supports refresh; it injects via
`Agent.getApiKey` so credentials can rotate mid-run.

### 6.7 What you need to copy

For a minimal Cog clone:

- **Pick one or two APIs.** `anthropic-messages` is the cleanest entry point
  (~300 LOC of real provider logic, the rest is auth/cache/sessions). For a
  second, `openai-completions` is the universal compat layer. Skip the codex
  / responses / vertex variants until you need them.
- **Inline models.** Cog doesn't need 17k lines of model metadata. A
  hand-written list of ~10 models per provider with the right
  `contextWindow`/`maxTokens` is plenty.
- **Adopt the `Api` registry pattern.** Even with 1 provider, structuring
  around `Model.api → registry → streamFn` is the right shape because the
  agent loop already speaks it.
- **Steal the `AssistantMessageEventStream` shape.** It is the cleanest part
  of pi-ai (`utils/event-stream.ts`, 87 LOC) and integrates naturally with
  the agent loop.

---

## 7. TUI (`pi-tui`)

### 7.1 Differential rendering, conceptually

Conventional terminal UIs (Ink, blessed) build a virtual DOM, diff React
trees, and emit ANSI to update changed cells. pi-tui is much simpler:

- A `Component` has one method: `render(width: number): string[]`
  (`packages/tui/src/tui.ts:39-63`). It returns an array of pre-styled
  lines. No layout boxes, no flexbox, no styling DSL — just lines.
- The TUI keeps `previousLines: string[]`. On each render pass it
  recomputes new lines, then **diffs by string equality per line**.
- It writes ANSI cursor moves + line clears + new content **only for the
  range `[firstChanged, lastChanged]`**. See
  `tui.ts:1053-1209` for the full diff loop.

Lines are deduplicated string-equality, so unchanged frames produce zero
output. The renderer runs throttled at 16ms (`tui.ts:253` `MIN_RENDER_INTERVAL_MS`).
Begin/end synchronized output (`\x1b[?2026h` / `?2026l`) wrap each frame so
terminals that support it commit atomically (`tui.ts:985`).

### 7.2 Why this is small

This design pushes most concerns into `render(width)`:

- **Wrapping**: each component is responsible for hard-wrapping at `width`.
  Helper: `utils.ts` `wrapTextWithAnsi`, `truncateToWidth`, `visibleWidth`
  (uses `get-east-asian-width` for CJK / emoji-correct widths).
- **Styling**: components hand back lines with ANSI codes inline. No
  CSS-like API. Themes are tables of `{fg, bg}` keyed by semantic role
  (e.g. `theme.fg("accent", "...")` returns a colored string —
  `coding-agent/src/modes/interactive/theme/theme.ts`).
- **Focus**: a single `focusedComponent` reference. If it implements
  `Focusable` (`tui.ts:74`), `focused = true` is set on it. The focused
  component emits a magic `CURSOR_MARKER` zero-width escape at the cursor
  position; TUI scans rendered lines for the marker, strips it, and emits
  hardware cursor positioning (`tui.ts:933-950`). This is what makes IME
  candidate windows position correctly on macOS / Windows.

### 7.3 Composition primitives

Just a `Container` (`tui.ts:200-234`) that holds an ordered list of children
and concatenates their `render(width)` output. No grids, no boxes. Overlays
are a separate concept (`tui.ts:329` `showOverlay`) that composite on top of
the base content lines via `compositeOverlays` (`tui.ts:758-817`). Overlay
positioning supports anchors (`center`, `top-left`, etc.), absolute
row/col, and percentage strings (`50%`). All positioning math is done with
visible-width-aware string slicing (`utils.ts` `sliceByColumn`,
`sliceWithWidth`).

### 7.4 Components shipped

| Component         | LOC  | Purpose                                                      |
| ----------------- | ---- | ------------------------------------------------------------ |
| `Text`            | 106  | Single string of text, wraps to width                        |
| `TruncatedText`   | 65   | Like `Text` but truncates to N lines with ellipsis           |
| `Box`             | 137  | Border + padding (Unicode box-drawing)                       |
| `Spacer`          | 28   | Empty lines                                                  |
| `Input`           | 503  | Single-line input (uses Editor under the hood)               |
| `Editor`          | 2292 | Multi-line text editor (the big one)                         |
| `Markdown`        | 797  | Markdown → terminal renderer (uses `marked`)                 |
| `Loader`          | 86   | Spinner with indicator + label                               |
| `CancellableLoader` | 40 | Loader + Esc to cancel                                       |
| `SelectList`      | 229  | Vertical select with keyboard nav                            |
| `SettingsList`    | 250  | SelectList variant for key/value rows                        |
| `Image`           | 126  | Inline image rendering (Kitty / iTerm2 protocols)            |

The editor is the most substantial part of pi-tui and isn't required for a
minimal coding agent — you can wire `readline`/`@inquirer/prompts` as a stub
and replace it later.

### 7.5 Input handling

`packages/tui/src/keys.ts` (1400 LOC) is a key event parser with support
for:
- Plain ASCII and control codes,
- Bracketed paste (`\x1b[200~ ... \x1b[201~`),
- Modified arrow/function keys,
- The Kitty keyboard protocol (precise modifier/key-release reporting),
- xterm `modifyOtherKeys` mode 2 as a fallback (for tmux).

`StdinBuffer` (`stdin-buffer.ts:411`) splits batched stdin into single key
events with a 10ms timeout heuristic, so a single `data` event with multiple
escape sequences gets demultiplexed before reaching component
`handleInput`s.

Keybindings are configurable per-component
(`tui/src/keybindings.ts:244`). The model is global tables of `KeybindingId
→ KeyData[]`, looked up by `matchesKey(received, "ctrl+x")`. AGENTS.md forbids
hardcoded `matchesKey(keyData, "ctrl+x")` in business logic — every binding
must go through a config table (`AGENTS.md:18-19`).

### 7.6 Terminal interface

`Terminal` is a 10-method interface (`tui/src/terminal.ts:16-58`).
`ProcessTerminal` (`terminal.ts:63`) is the real implementation:

- Sets raw mode on stdin, registers `data`/`resize` listeners.
- Enables bracketed paste mode at startup.
- Queries Kitty keyboard protocol support; if absent, falls back to xterm
  modifyOtherKeys (`terminal.ts:192-202`).
- Optionally enables Windows ENABLE_VIRTUAL_TERMINAL_INPUT via dynamic
  `koffi` FFI to kernel32 — but only on Windows, and `koffi` is an
  `optionalDependencies` entry (~70MB across platforms saved by skipping)
  (`terminal.ts:210-231`, `tui/package.json:43`).
- `drainInput(maxMs, idleMs)` is called on shutdown to consume late
  key-release events that would otherwise leak to the parent shell over SSH
  (`terminal.ts:233-269`).

A `Terminal` interface means you can substitute a fake terminal in tests —
pi-tui's tests use `@xterm/headless` as a devDependency to do exactly that
(`tui/package.json:46-47`).

### 7.7 Dependency footprint

`packages/tui/package.json:38-44`:

```json
"dependencies": {
  "get-east-asian-width": "^1.3.0",
  "marked": "^15.0.12"
},
"optionalDependencies": { "koffi": "^2.9.0" }
```

**Two runtime deps.** Compare to Ink which pulls in `react`, `react-reconciler`,
`yoga-layout`, `cli-cursor`, `cli-truncate`, and ~30 other transitive
packages. The cost is no flexbox, no React; you write `render(width):
string[]`. The win is bundle size and zero abstraction surface.

### 7.8 What Cog should consider

If you don't need an editor or rich markdown, you can ship a vastly simpler
TUI:
- One `Terminal` interface with the same 10 methods.
- A `TUI` class with the differential renderer (`tui.ts:953-1280` is ~300
  LOC, the meat is line diffing).
- One `Container`, one `Text`, one `Loader`, one `Markdown`. That's it.
- Use `marked` like pi does, or skip it and print plain text.

The whole story replicates in <1000 LOC vs. ~10k in pi-tui.

---

## 8. Dependencies overall

### 8.1 What pi actually depends on at runtime

`pi-ai`:
- `@anthropic-ai/sdk`, `openai`, `@google/genai`, `@mistralai/mistralai`,
  `@aws-sdk/client-bedrock-runtime` — one per provider family.
- `typebox` — schemas.
- `partial-json` — repairing truncated JSON tool-call arguments while
  streaming.
- `http-proxy-agent` / `https-proxy-agent` / `proxy-from-env` — corporate
  proxies.

`pi-agent-core`:
- `pi-ai`, `typebox`, `yaml`, `ignore`.

`pi-tui`:
- `marked`, `get-east-asian-width`. Optional `koffi`.

`pi-coding-agent`:
- All three above plus `chalk`, `diff`, `glob`, `highlight.js`,
  `hosted-git-info`, `ignore`, `jiti`, `minimatch`, `proper-lockfile`,
  `typebox`, `undici`, `yaml`. Optional `@mariozechner/clipboard`,
  `@silvia-odwyer/photon-node` (WASM image processing).

### 8.2 What you could drop in Cog

For an MVP Cog targeting one provider, one tool surface, and a
print-output mode (no interactive TUI yet):

- **Provider SDK** for your chosen provider — Anthropic SDK is well-typed
  and tracks API changes.
- **typebox** — pi uses it for tool schemas, and tool schemas need to be
  JSON-Schema-shaped anyway.
- **diff** — for the edit tool's preview output (if you have one).
- **glob** or **fast-glob** — if you ship a grep/find tool.

That's it. Skip:
- `marked`/`highlight.js` until you want pretty markdown rendering.
- `chalk` (use ANSI escape codes directly — pi-tui's theme system already
  does this).
- `undici` (you only need it if you want process-wide proxy support;
  `fetch` works for most cases).
- `yaml`, `jiti` — only relevant if you support extension config
  files / Skill front-matter.
- `@anthropic-ai/sdk`'s SSE iterator — pi reimplements SSE parsing
  (`anthropic.ts:328`) because the SDK's iterator hides errors. For Cog v1 the
  SDK iterator is fine.

### 8.3 Estimated minimum LOC for Cog v1

Reasonable target for "minimal working coding agent":

| Module                              | LOC target |
| ----------------------------------- | ---------- |
| Types (`AgentMessage`, etc.)        | 200        |
| Agent loop                          | 400        |
| Stateful Agent wrapper              | 300        |
| One provider (Anthropic)            | 400        |
| Tool runtime + 4 tools (read/write/bash/edit) | 800 |
| System prompt + session JSONL       | 300        |
| Minimal print mode CLI              | 200        |
| **Total**                           | **~2.6k**  |

vs. pi's ~26k LOC total. The 10x reduction is mostly: no TUI, no
compaction, no 30 providers, no extension system, no auth/OAuth, no
markdown renderer, no skills/templates, no model registry. You can add
those back over time without reshaping the core.

---

## 9. Concrete patterns worth stealing

A grab-bag of decisions where pi got it right, with the minimum file:line
needed to remember why.

1. **Agent state via accessor copies** (`agent.ts:75-86`) — `state.messages =
   newArr` copies the top-level array. Prevents accidental shared-reference
   bugs when the loop appends and a subscriber races on read.

2. **`stopReason` for terminal flow control** (`types.ts:269`). Every
   assistant message ends with one of `"stop" | "length" | "toolUse" |
   "error" | "aborted"`. The loop branches on this in one place
   (`agent-loop.ts:196`) rather than scattered try/catch.

3. **Custom messages via declaration merging** (`types.ts:283-301`).
   `CustomAgentMessages` is an empty interface that apps extend; the
   `AgentMessage` union picks it up. Apps thread custom messages through
   the loop type-safely without forking core types.

4. **Lazy provider modules** (`providers/register-builtins.ts:159-201`).
   First call dynamic-imports; subsequent calls are cached. Cold-start cost
   for providers you never use is zero, and a broken provider doesn't
   prevent the binary from starting.

5. **`prepareNextTurn` for atomic state swaps** (`agent-loop.ts:226-239`).
   Lets the harness change model/context/thinking mid-run without races.
   `Agent.continue()` after slash-command model switch flows through this.

6. **Tool result `details` blob** (`types.ts:339`). Separates "what the
   model sees" (`content`) from "what the UI/log layer wants" (`details`).
   No coupling between renderers and the LLM message format.

7. **CURSOR_MARKER for IME positioning** (`tui.ts:90, 933`). A zero-width
   APC escape that components emit at the cursor position. TUI strips it
   from the output and positions the hardware cursor there. Avoids needing
   components to know their absolute screen position.

8. **`Tool.execute(id, args, signal, onUpdate)`** (`types.ts:362`).
   `onUpdate` is the only way tools stream partial output; the loop wraps
   each call in `Promise.resolve(emit(...))` so per-keystroke updates are
   sequenced through the event queue without dropping.

9. **`getApiKey: (provider) => string | undefined`** as a per-request hook
   (`agent.ts:171, agent-loop.ts:302`). Critical for short-lived OAuth (pi
   supports GitHub Copilot whose token rotates every hour). Don't bake API
   keys into config — make resolving them a per-request callable.

10. **JSONL append-only sessions** (`session/repo/jsonl.ts`). One entry per
    line. Crash-safe, easy to fsck, trivially mergeable. The "tree"
    semantics come from `parentId` fields, not file structure.

---

## 10. Quick reference: file map

If you want to scan the most load-bearing files in order, this is the path:

1. `packages/ai/src/types.ts` — message shapes, event protocol, model shape.
2. `packages/ai/src/utils/event-stream.ts` — the streaming primitive.
3. `packages/ai/src/api-registry.ts` + `providers/register-builtins.ts` —
   how providers are pluggable.
4. `packages/ai/src/providers/anthropic.ts:428-700` — one full provider
   from request to event emission.
5. `packages/agent/src/types.ts` — agent-level types (`AgentTool`,
   `AgentEvent`, `AgentLoopConfig`).
6. `packages/agent/src/agent-loop.ts` — the actual loop. Read top to
   bottom.
7. `packages/agent/src/agent.ts` — stateful wrapper + queues + abort.
8. `packages/coding-agent/src/core/tools/read.ts` — a representative tool
   end-to-end.
9. `packages/coding-agent/src/core/sdk.ts:193-413` — full
   `createAgentSession` wiring (auth, model resolution, streamFn).
10. `packages/tui/src/tui.ts:953-1280` — differential renderer core.

You'll have a complete mental model of the system after these ten files
(~5k LOC total, mostly comments and types).
