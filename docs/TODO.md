# Cog — TODO

> **Current milestone: M3 — Bare TUI against the mock.**
> Work top to bottom. Check items as you complete them.
> M0, M1, and M2 are done.

---

## Locked decisions (don't relitigate)

- Node 22 LTS
- pnpm workspaces, bare package names (`cog`, `agent`, `tui`, `tools`, `providers`). Root is `cog-monorepo` so the CLI package can claim the bare `cog` name.
- ESM only (`"type": "module"` everywhere)
- TypeScript via **tsc** (stock `typescript` package). Revisit tsgo later once it's stable / has stabilized package naming
- **Biome** only (no eslint, no prettier)
- **Vitest** for testing (deferred until after M3)
- MIT license
- CLI binary name: `cog`
- **Node builtins over external packages, always.** Any external dep needs a 1-line justification in the PR / commit message.

---

## M0 — Scaffolding

Goal: `pnpm install && pnpm typecheck && pnpm lint && pnpm build && pnpm dev` all succeed with empty packages, and `pnpm dev` prints a banner and exits 0.

### M0.1 — Root files (do these first, in order)

- [x] `.gitignore` — `node_modules/`, `dist/`, `.cog/`, `.DS_Store`, `*.log`
- [x] `.nvmrc` — `22`
- [x] `LICENSE` — MIT, your name, year 2026
- [x] `pnpm-workspace.yaml` — `packages: ['packages/*']`
- [x] Root `package.json` — `private: true`, `type: "module"`, no deps yet, scripts stubs (filled in M0.5)
- [x] `biome.json` — formatter + linter config (recommended ruleset, 2-space indent, single quotes, trailing commas)
- [x] `tsconfig.base.json` — strict, `noUncheckedIndexedAccess`, `moduleResolution: "nodenext"`, `module: "nodenext"`, `target: "es2024"`, `declaration: true`, `sourceMap: true`
- [x] `README.md` — 10 lines max. What Cog is, link to `docs/RESEARCH.md`, link to this file
- [x] `CLAUDE.md` — instructions for Claude when invoked in this repo: coach, don't code; read `docs/RESEARCH.md` and `docs/TODO.md` on session start; pick up where last left off

### M0.2 — Package skeletons

Create these five directories, each with `package.json`, `tsconfig.json` (extends root), `src/index.ts` (empty export), `README.md` (one paragraph).

- [x] `packages/tui/` — terminal UI primitives. **No internal deps.**
- [x] `packages/providers/` — LLM provider clients (Anthropic, mock, etc.). **No internal deps.**
- [x] `packages/tools/` — built-in tools (read/write/edit/bash/grep/glob). **No internal deps.**
- [x] `packages/agent/` — agent loop, session, tool registry. Depends on: `tools`, `providers` (interface only).
- [x] `packages/cog/` — the CLI. Depends on: `agent`, `tui`, `providers`.

Per-package `package.json` checklist:

- [x] `name` matches directory (bare, no scope)
- [x] `"type": "module"`
- [x] `"main": "./dist/index.js"`, `"types": "./dist/index.d.ts"`
- [x] `exports` field pointing to `./dist/index.js`
- [x] `scripts`: `typecheck`, `build`, `test`, `clean`
- [x] Only `packages/cog` gets a `"bin"` field: `{ "cog": "./dist/cli.js" }`

### M0.3 — Toolchain wiring

- [x] Install dev deps at root: `typescript`, `@biomejs/biome`, `vitest`, `@types/node`. Nothing else.
- [x] Per-package `tsconfig.json` extends `../../tsconfig.base.json`, sets `outDir: "./dist"`, `rootDir: "./src"`, references upstream packages via `references` field

### M0.4 — Minimal `cog` binary

Entry-point pattern: TS sources export `main()` from `src/index.ts`. A hand-written shim at `bin/cli.js` carries the shebang and calls into the compiled `dist/index.js`. Keeps shebangs out of TS source and avoids any post-build shebang prepend step.

- [x] `packages/cog/src/index.ts` — exports a `main()` function. With no flags, prints the help message. With `--help` / `-h`, prints help. Exits non-zero on parse errors.
- [x] `packages/cog/src/parser.ts` — thin wrapper around `node:util.parseArgs` (no `commander` / `yargs`). Owns the `CLI_OPTIONS` table.
- [x] `packages/cog/src/help.ts` — exports `printHelpMessage()` returning the usage block.
- [x] `packages/cog/bin/cli.js` — hand-written ESM shim with `#!/usr/bin/env node` shebang; body is `import { main } from "../dist/index.js"; main();`. Not compiled, not edited often.
- [x] `packages/cog/package.json` `bin` field points to `./bin/cli.js`.

### M0.5 — Root scripts

Fill these into root `package.json`:

- [x] `"typecheck": "pnpm -r typecheck"`
- [x] `"build": "pnpm -r build"`
- [x] `"test": "pnpm -r test"`
- [x] `"lint": "biome check ."`
- [x] `"format": "biome format --write ."`
- [x] `"dev": "pnpm --filter cog dev"` — for now `dev` in `packages/cog` is `tsc --watch` + a node runner, or just `tsc && node dist/cli.js`. Pick whichever is simpler.
- [x] `"clean": "pnpm -r clean"`

Per-package scripts inside `packages/<name>/package.json`:

- [x] `"typecheck": "tsc --noEmit"`
- [x] `"build": "tsc"`
- [x] `"test": "vitest run"` — even though no tests exist yet, this returns 0 if no test files. Verify.
- [x] `"clean": "rm -rf dist"`

### M0.6 — Verification (don't move on until all pass)

- [x] `pnpm install` — no errors
- [x] `pnpm typecheck` — green
- [x] `pnpm lint` — green
- [x] `pnpm build` — green, produces `dist/` in every package
- [x] `pnpm test` — green (no tests yet, but the command runs)

### M0.7 — Commit

- [x] Single commit: `chore: M0 scaffolding — pnpm workspaces, biome, tsc, 5 packages, empty cog CLI`

---

## M1 — TUI design doc (parallel with M0)

**I am drafting this** in `docs/TUI-DESIGN.md`. When you've finished M0, read it, react, push back. Don't start M3 (TUI implementation) until M1 is signed off.

- [x] Read `docs/TUI-DESIGN.md` once it lands
- [x] React to: color choices, layout, screen states I missed, slash command list, status bar contents
- [x] Sign off (or send back for changes)

---

## M2 — StreamEvent contract + mock provider

Goal: a `MockProvider` that reads scripted JSON scenarios and emits realistic streaming events. Real Anthropic later (M5) is a drop-in behind the same interface. The canonical event shape is defined in `docs/TUI-DESIGN.md §10`; this milestone makes it real code.

**Exit criteria:** `cog --mock <path-to-scenario>` runs and prints each event to stdout with realistic timing. M3 will replace the stdout dumper with the actual TUI; nothing else changes about this milestone's surface.

### M2.1 — StreamEvent types in `packages/providers`

The wire shape between providers and the agent loop / TUI. Mirrors `TUI-DESIGN.md §10` exactly.

- [x] `packages/providers/src/types.ts` — discriminated union `StreamEvent` with 10 variants: `text_delta`, `tool_use_start`, `tool_use_running`, `tool_use_end`, `permission_ask`, `status_change`, `error`, `stop`, `compact_start`, `compact_end`. Use the `type` field as the discriminant.
- [x] Same file: `TextContent` (`{ type: 'text', text: string }`), `ImageContent` (deferred, `{ type: 'image', ... }` stub), plus the `Provider` interface and `ProviderInput` type.
- [x] `Provider.stream(input: ProviderInput): AsyncIterable<StreamEvent>` — async iterable, not Promise<array>. Streaming is the point.
- [x] `ProviderInput` fields: `messages: unknown[]` (will be tightened in M6), `tools?: unknown[]` (same), `model: string`, `signal?: AbortSignal`. The mock ignores everything except `signal`.
- [x] `packages/providers/src/index.ts` — re-export everything from `./types.js` and `./mock.js`.

### M2.2 — Scenario file format

A scenario is a JSON file describing a scripted stream. The mock reads it and replays the events with timing.

- [x] `packages/providers/scenarios/README.md` — documents the format:
  - Top-level: `{ name, description, events: [...] }`.
  - Each event is the same shape as `StreamEvent` plus a `delayMs` field that tells the mock how long to wait _before_ emitting it.
  - `delayMs` defaults to 0; large values (~100–500ms) simulate model latency between tokens.
  - Events should end with a `stop` event (mock errors loudly if missing).
- [x] Define a `ScenarioFile` type in `packages/providers/src/types.ts` so the loader is typed end-to-end.

### M2.3 — MockProvider implementation

- [x] `packages/providers/src/mock.ts` — `MockProvider` class implementing `Provider`.
- [x] Constructor takes the scenario file _path_ (not the parsed object). Reads + parses with `node:fs/promises.readFile` + `JSON.parse` on first `stream()` call. (No caching: re-read each session so edits take effect.)
- [x] `stream(input)` returns an async generator that loops over events; before each one, `await setTimeout(event.delayMs ?? 0)` from `node:timers/promises`.
- [x] Honor `input.signal`: between every event, check `signal?.aborted` and if so, yield a final `{ type: 'stop', reason: 'aborted' }` and return.
- [x] Validate the scenario shape at load time: missing `events`, missing terminal `stop`, or unknown event `type` should throw with a clear message including the file path.

### M2.4 — Canonical scenarios

These are both demo material and (later) test fixtures. Each lives at `packages/providers/scenarios/<name>.json`.

- [x] `hello.json` — `thinking` status → 3-4 `text_delta` events with 50–200ms gaps → status null → `stop`. The "does the simplest thing work" scenario.
- [x] `tool-call.json` — text intro → `tool_use_start` (`read_file`) → `tool_use_running` → `tool_use_end` with result → text follow-up → `stop`. Exercises the tool block rendering.
- [x] `permission.json` — text intro → `tool_use_start` (`bash`) → `permission_ask` (`{ patterns: ['pnpm test *'] }`) → `stop`. Halts so the user can answer.
- [x] `error.json` — partial text → `error` with `recoverable: true` → `stop`. Exercises §4.11.
- [x] `compaction.json` — `compact_start` (tokens before) → wait ~1500ms → `compact_end` (tokens after) → text → `stop`. Exercises §4.14.

Optional in M2, easy to add later: `long-edit.json` (multi-paragraph realistic stream), `doom-loop.json` (3× same tool call — needs the agent loop in M6 to actually detect).

### M2.5 — CLI wiring (temporary stdout dumper)

The CLI's M2 job: prove the provider works end-to-end before M3 wires the TUI. Anything more than this is wasted work — M3 replaces this glue.

- [x] `packages/cog/src/parser.ts` — add a `mock` string option to `CLI_OPTIONS`: `{ type: 'string', short: 'm' }`. Update help text in `help.ts`.
- [x] `packages/cog/src/index.ts` — when `cliFlags.mock` is set: import `MockProvider` from the `providers` package, instantiate it with the path, call `stream({ messages: [], model: 'mock', signal: undefined })`, and for-await each event, `console.log(JSON.stringify(event))`. Throwaway code; tagged with a `// TODO(M3): replace with TUI`.
- [x] `packages/cog/package.json` — `providers` is already a workspace dep, no change.

### M2.6 — Verification

- [x] `pnpm typecheck` — green (the discriminated union should narrow correctly without `as` casts).
- [x] `pnpm lint` — green.
- [x] `pnpm build` — green.
- [x] `node packages/cog/bin/cli.js --mock packages/providers/scenarios/hello.json` — prints 5+ JSON event lines to stdout with visible delays between them, last line is `{"type":"stop", ...}`, exits 0.
- [x] Same for each other canonical scenario — `tool-call`, `permission`, `error`, `compaction`.
- [x] Abort smoke test: `Ctrl-C` mid-stream produces a `stop` event with `reason: "aborted"` (not a stack trace).

### M2.7 — Commit

- [x] Single commit: `feat(providers): M2 StreamEvent contract + MockProvider with scripted JSON scenarios`

---

## M3 — Bare TUI against the mock

Goal: a real terminal UI that consumes `StreamEvent`s from `MockProvider` and renders them per `docs/TUI-DESIGN.md`. The throwaway stdout dumper from M2.5 gets replaced. By the end of M3, `cog --mock <path>` opens a TUI, plays the scenario with proper colors and layout, and exits cleanly on Esc / Ctrl-C.

**Scope discipline:** M3 is the _bare_ TUI. Single-line input, no slash commands, no mouse, no themes besides default, no $EDITOR mode, no scrollback. All of that is M4 polish. If a feature isn't required to render one of the 5 canonical scenarios end-to-end, it doesn't belong in M3.

**Exit criteria:** every one of the 5 scenarios in `packages/providers/scenarios/` (`hello`, `tool-call`, `permission`, `error`, `compaction`) renders with the right visual treatment per the design doc, and Esc cleanly aborts mid-stream.

This milestone is the biggest one yet — budget ~3–5 days. The order below is the recommended build order; later items depend on earlier ones.

### M3.1 — Terminal primitives

Low-level wrapping around `process.stdin` / `process.stdout`. Single file, ~150 LOC target.

- [x] `packages/tui/src/terminal.ts` — owns raw mode lifecycle, ANSI escape helpers, and width detection.
- [x] Raw-mode entry/exit functions. Restore the terminal on **any** exit (normal, SIGINT, SIGTERM, uncaught exception) so a crash never leaves the user with a broken shell.
- [x] ANSI helpers as small inline functions: `cursorTo(row, col)`, `clearLine()`, `hideCursor()`, `showCursor()`, `altScreenEnter()`, `altScreenExit()`, `syncOutputStart()` / `syncOutputEnd()` (the `\x1b[?2026h` / `\x1b[?2026l` wrapper).
- [x] Width / height: read once from `process.stdout.columns/rows` plus a `resize` event listener that re-renders on next tick.
- [x] Refuse to start if width < 60 cols (per `TUI-DESIGN.md §8`): print the error to stderr and exit 1.

### M3.2 — Theme module

The role-based color lookup that `docs/TUI-DESIGN.md §2.1` requires.

- [x] `packages/tui/src/theme/index.ts` — exports a `Theme` interface with methods like `fg(role): string`, `bg(role): string`, `reset(): string`, `bold(): string`, `italic(): string`, `dim(): string`.
- [x] Role names match the design exactly: `default`, `dim`, `accent`, `success`, `danger`, `warning`, `user-bg`.
- [x] `packages/tui/src/theme/default.ts` — the only theme in v1. Maps each role to an ANSI escape per the table in `TUI-DESIGN.md §2.1`.
- [x] Pure functions, no global state. The renderer passes a `theme` reference into each component when calling `render`.

### M3.3 — Differential renderer

The heart of the TUI. Single file, ~300 LOC target. Mirrors pi-tui's approach (see `docs/pi-reference.md §7`).

- [x] `packages/tui/src/renderer.ts` — exports a `Renderer` class and a `Component` interface.
- [x] `Component` interface: a single `render(width: number, theme: Theme): string[]` method returning one styled line per array element.
- [x] `Renderer` constructor takes a `Terminal` (from M3.1) and a `Theme`.
- [x] `Renderer.mount(rootComponent)` and `Renderer.scheduleRedraw()` — coalesces redraws to one per 16ms tick.
- [x] Diff loop: keep `previousLines: string[]`, compute new lines, find first and last changed index, emit ANSI cursor-positioning + line-clear + new content only for the changed range.
- [x] Wrap each frame in `syncOutputStart()` / `syncOutputEnd()` so terminals that support synchronized output commit atomically.
- [x] No layout helpers (no flexbox, no grids). Components handle their own wrapping at the given `width`.

### M3.4 — Key parsing

Just enough to handle the keys M3 actually uses. Defer mouse, kitty, bracketed paste to M4.

- [x] `packages/tui/src/keys.ts` — exports a `KeyEvent` discriminated union and a `parseInput(chunk: Buffer): KeyEvent[]` function.
- [x] Variants needed for M3: `{ type: 'char', value: string }`, `{ type: 'enter' }`, `{ type: 'esc' }`, `{ type: 'ctrl-c' }`, `{ type: 'backspace' }`, `{ type: 'arrow', dir: 'up' | 'down' | 'left' | 'right' }`. That's it.
- [x] Stdin reader: `terminal.onKey((event) => ...)`. Handles batched escape sequences with a small timeout (10ms) so e.g. `Esc` vs `Alt+x` are distinguishable.

### M3.5 — Components

One file per component under `packages/tui/src/components/`. Each implements the `Component` interface from M3.3. ~100 LOC each.

- [x] `components/transcript.ts` — the scrolling chat area. Owns a list of "blocks" (user message, assistant message, tool call, error). Each block renders its own lines via a pure module-level `renderBlock` dispatch; the transcript concatenates them with a blank line between blocks. Per `TUI-DESIGN.md §2.3`, user messages render with `theme.bg('user-bg')` padded to full width; assistant/error messages render plain. **Tool block renders a minimal status line only in M3** (`✓/✗/⋯` + name); rich output rendering deferred — see Follow-ups. (Permission prompt is a separate component, not a transcript block.)
  - Mutators (`appendUser`, `appendAssistantDelta`, `startTool`, `updateTool`, `finalizeTool`, `appendError`, `clear`) drive all state; `appendAssistantDelta` create-or-extends via a `currentAssistantId` pointer. Smoke test at `packages/tui/src/scripts/transcript.ts` (9 cases) confirms wrapping, status glyphs, error branches, delta-coalescing, and block spacing.
- [x] `components/input-box.ts` — **borderless** input region. Renders `N` content rows (no top/bottom borders, no side `│` borders): `❯ <text>` on row 0, `  <text>` on continuation rows. Owns the buffer + cursor position. Handles char insert, backspace, left/right arrow nav, and **soft wrap at the right edge** — the region grows downward as the buffer fills past `width - INNER_WIDTH_DELTA`. Cursor renders as a one-column reverse-video overlay (`\x1b[7m` / `\x1b[27m`) on the underlying character, so the buffer text stays visible inside the highlight. Prompt is `theme.dim()`.
  - Wrap math lives in a pure module-level `wrapBuffer(buffer, cursorPos, innerWidth)` helper above the class. Returns `{ rows, cursorRow, cursorCol }` with the invariant that `rows[cursorRow]` always exists (empty rows appended for empty-buffer / wrap-boundary edge cases).
  - **Deferred to M4**: word-aware wrapping (M3 breaks at char boundaries), explicit `Shift+Enter` newlines, history, bracketed paste, `$EDITOR` mode, scrollback for buffers that exceed terminal height.
- [x] `components/status-bar.ts` — two rows. Top: cwd (full width). Bottom: `<pct>%/<window>k (<mode>)` left, `<model> • thinking <on|off>` right. Static defaults for `mode` and `thinking` until M9 / M5+ wire them up. Per `TUI-DESIGN.md §5`.
- [x] `components/activity-line.ts` — the spinner above the input box. Renders one line: `⣾ <label>` when active, empty when idle. Cycles spinner frame every 80ms (the renderer's tick advances it). Per `TUI-DESIGN.md §4.3`.
- [x] `components/permission-prompt.ts` — **borderless, arrow-nav popover** in the slot normally held by the input box (the orchestrator removes the input box while the prompt is active). 4 options (Yes / Yes, don't ask again / No / Type something), navigated by arrows or Tab/Shift+Tab, confirmed by Enter, dismissed by Esc (resolves `"no"`). `show(args)` returns a `Promise<PermissionChoice>`; throws on re-entry. Implements `Component, KeyHandler` — the new shared interface in `renderer.ts`. Per `TUI-DESIGN.md §4.7`.
  - Also done as part of this work: `KeyHandler` interface added to `renderer.ts`; `keys.ts` extended with `tab` variant (`dir: "forward" | "back"`) and parsing for `0x09` + CSI `Z`; `§4.7` design doc rewritten for arrow-nav (single-key shortcuts intentionally not supported).
  - Smoke test at `packages/tui/src/scripts/permission-prompt.ts` — 10 cases covering all 4 options' resolution values, arrow/Tab navigation, both-side clamping, and the dormant render-after-resolve.

### M3.5a — Component smoke tests

Throwaway scripts under `packages/tui/scripts/` that instantiate a component, render it at varied widths, and print the result to stdout wrapped in `|...|` guides for visual alignment checks. No assertions, no framework — just eyeball verification before vitest comes online in M4. Scripts live outside `src/` so they're not compiled or shipped.

Run with `node --experimental-strip-types packages/tui/scripts/<name>.ts` (or `npx tsx` as fallback).

- [x] `scripts/smoke-status-bar.ts` — exercise `StatusBar` at widths 80 / 60 / 40, with `thinking` on/off, with a deep cwd that needs left-truncation, and with `tokensUsed > contextWindow` to surface the over-100% case. Verify visually: pipes line up, suffix drops at narrow widths, model truncates last.
- [x] `scripts/smoke-activity-line.ts` — once `activity-line.ts` exists.
- [x] `scripts/smoke-input-box.ts` — 7 cases: empty box, typing "hello", backspace at end, backspace at empty (no-op), cursor-in-middle insert, arrow boundaries (clamp at start/end), long buffer overflow. Lives at `packages/tui/src/scripts/input-box.ts` (note: in `src/` rather than the originally-planned `packages/tui/scripts/`; consider moving outside `src/` when resuming so it doesn't get compiled into `dist/`).
- [x] `scripts/smoke-transcript.ts` — Lives at `packages/tui/src/scripts/transcript.ts`. 9 cases: single user message, user message with wrapping, single assistant message, assistant deltas coalescing into one block, tool lifecycle (start / success / error), error block (recoverable + non-recoverable), and a mixed conversation exercising blank-line spacing between blocks.
- [x] `scripts/smoke-permission-prompt.ts` — Lives at `packages/tui/src/scripts/permission-prompt.ts`. 10 cases: initial render, arrow-down navigation, both clamping edges (up at 0, down past last), Tab/Shift+Tab as arrow aliases, and an Enter case per option (Yes / Yes-always / No / Type-something) that verifies the index-to-value mapping in the resolution log. Helper splits navigation cases (no top-level await) from resolution cases (top-level `await`).

### M3.6 — TUI orchestration

Pulls everything together into one class that's easy to use from `cog`.

Broken into 5 chunks: (1) class skeleton + render composition; (2) lifecycle (start/stop); (3) key routing; (4) `handleEvent(StreamEvent)` mapping = §M3.7 bridge; (5) wire into `cog` = §M3.8.

- [x] `packages/tui/src/index.ts` — exports a `TUI` class implementing `Component`. (Chunk 1)
- [x] `new TUI()` builds the root component tree — instantiates `Transcript`, `ActivityLine(null)`, `InputBox`, `PermissionPrompt`, `StatusBar(cwd, "mock", 200k, 0)`. `render(width, theme)` stacks them vertically: transcript → activity → (permission prompt OR input box, mutually exclusive via `promptLines.length > 0` check) → status bar. (Chunk 1)
- [ ] `tui.start()` enters alt screen, hides cursor, attaches stdin handler, kicks off the render loop. **(Chunk 2 — next pickup)**
- [ ] `tui.stop()` exits alt screen, shows cursor, detaches handlers, restores raw mode. (Chunk 2)
- [ ] Key routing: a single `onKey` subscription routes each `KeyEvent` to either the permission prompt (if active) or the input box. (Chunk 3)
- [ ] `tui.handleEvent(event: StreamEvent)` — the bridge between the provider stream and the components (see §M3.7). (Chunk 4)
- [ ] Re-export `Component`, `Theme`, `KeyEvent`, `KeyHandler` for downstream packages. (End of M3.6)
- **Open detail from chunk 1 review**: type-only imports for `Component` and `Theme` (currently value imports — minor, doesn't break anything). Address in the next touch of the file.

### M3.7 — Event-to-state mapping

This is what makes the TUI a _real_ consumer of the streaming contract. Lives inside `TUI.handleEvent()`.

For each `StreamEvent` variant:

- [ ] `text_delta` → append `delta` to the current streaming assistant block in the transcript. If no current block, create one.
- [ ] `tool_use_start` → push a new tool block to the transcript with status `running`. Store the `id` for later lookup.
- [ ] `tool_use_running` → optional `partialOutput` updates the existing tool block.
- [ ] `tool_use_end` → finalize the tool block: store `result`, render in success or danger color based on `isError`. Collapse to first 3 lines by default per `TUI-DESIGN.md §4.5`.
- [ ] `permission_ask` → render the permission prompt block; await the user's single-key answer (the input box is dimmed while pending).
- [ ] `status_change` → update the activity line's label. `active: null` → hide the line entirely.
- [ ] `error` → render an error block in danger color (`TUI-DESIGN.md §4.11`).
- [ ] `compact_start` → set the status bar's top-row indicator to `⋯ compacting` in warning color.
- [ ] `compact_end` → clear the compacting indicator; update token count from `tokensAfter`.
- [ ] `stop` → flush any in-flight streaming block. Caller (the for-await in cog) breaks out of the loop after this event.

### M3.8 — Wire mock to TUI in `cog`

Replace the M2.5 stdout dumper. ~20 lines of work.

- [ ] Delete the `console.log(JSON.stringify(event))` block in `packages/cog/src/index.ts` and the `TODO(M3)` comment above it.
- [ ] Add `cog-tui` (or `tui`, depending on your final package name) as a workspace dependency in `packages/cog/package.json` if it isn't already.
- [ ] Import the `TUI` class. Inside the `else if (cliFlags.mock)` branch:
  1. `const tui = new TUI()` then `tui.start()`.
  2. Wire the existing `AbortController` so Esc inside the TUI calls `controller.abort()` (in addition to the SIGINT listener).
  3. `for await (const event of events) tui.handleEvent(event)`.
  4. `tui.stop()` after the loop (in `finally`).

### M3.9 — Verification (don't move on until all pass)

- [ ] `pnpm typecheck` — green.
- [ ] `pnpm check` — green.
- [ ] `pnpm build` — green; `packages/tui/dist/` exists.
- [ ] **Visual:** `cog --mock packages/providers/scenarios/hello.json` — text streams with the right styling, status bar reads `model=mock`, transcript clears on exit.
- [ ] **Visual:** `tool-call.json` — tool block renders with `↳ read_file` prefix, collapses to 3 lines.
- [ ] **Visual:** `permission.json` — inline `[y]/[a]/[n]/[N]` prompt appears mid-transcript; input box is dimmed while waiting.
- [ ] **Visual:** `error.json` — error block in red with `r/q` shortcuts visible.
- [ ] **Visual:** `compaction.json` — `⋯ compacting` indicator appears in status bar top row, disappears when `compact_end` fires.
- [ ] **Abort:** start a long scenario, press Esc — last block is the aborted-stop, terminal restored cleanly, no orphaned ANSI codes in the parent shell.
- [ ] **Crash test:** introduce a deliberate throw inside the for-await loop, hit it, confirm terminal restores. Then revert the throw.

### M3.10 — Commit

- [ ] Single commit: `feat(tui): M3 bare TUI consuming StreamEvents from MockProvider`

---

## M4 — TUI polish

- Token / cost display in status bar
- Explicit newlines in input box (`Shift+Enter` inserts `\n` into the buffer; M3 already handles soft wrap at the right edge)
- Word-aware wrapping (M3 breaks at character boundaries; M4 prefers word boundaries when possible)
- `$EDITOR` mode for long writes (`Ctrl+E` to open vim/code)
- Paste handling (bracketed paste)
- Themes
- Slash command palette
- Scrollback / page-up / search

---

## M5 — Real Anthropic provider

- Real Anthropic SDK (only external dep we'll add)
- Hard-coded model: `claude-haiku-4-5`
- Same `StreamEvent` interface as the mock — drop-in replacement
- `ANTHROPIC_API_KEY` from env via `process.loadEnvFile()`

---

## M6 — Tools + agent loop

- Tool registry skeleton
- 4 read-only tools first: `read_file`, `list_dir`, `grep`, `glob`
- Agent loop assembles tool_use blocks, dispatches, appends results
- Permission prompt before each tool run

---

## M7 — Write tools (gated)

- `write_file`, `edit_file`, `bash`
- Path jail (writes confined to cwd)
- Auto-allow read-only tools, prompt for writes/bash

---

## M8 — Session persistence + resume

- JSONL append-only session log in `~/.cog/sessions/`
- `cog --resume <id>`
- `cog --continue` (most recent)

---

## M9 — Context compaction

- Token counting from model usage
- Summarize-oldest trigger at ~80% window

---

## M10 — Second provider + cheap-first routing

- OpenAI-compatible provider behind same interface
- Model picker
- Default routing: Haiku 4.5 cheap, Sonnet 4.6 mid
- **`/login` and `/logout` slash commands** — per-provider credential flow (OAuth for Claude/Copilot, API key for OpenAI-compatible). Credentials persisted under `~/.cog/auth/<provider>.json`.

---

## M11 — Sandboxing

- `sandbox-exec` (macOS) / `bwrap` (Linux) for `bash`
- Network deny-by-default with allowlist

---

## M12 — Polish & extensibility

- COG.md / AGENTS.md / CLAUDE.md auto-read in system prompt
- Slash commands from `.cog/commands/*.md` (local + global at `~/.cog/`)
- Skills directory `.cog/skills/`
- Prompt caching breakpoints
- Doom-loop detector
- `todo_write` / `todo_read` tools
- Per-tool output caps and timeouts
- 20-task eval harness with binary pass/fail

---

## Cross-cutting principles (apply at every milestone)

- **Node builtins over external packages.** If you reach for `chalk`, stop — use ANSI directly. If you reach for `commander`, stop — `util.parseArgs`. If you reach for `nanoid`, stop — `crypto.randomUUID()`. If you reach for `dotenv`, stop — `process.loadEnvFile()`. If you reach for `glob`, prefer `fs.glob()` (Node 22+) or shell out to `rg --files -g`.
- **No dep without a 1-line justification** in the commit message.
- **Tests use vitest only.** Never mix in `node:test`.
- **Each new feature gets a README update in its package.**
- **Each milestone gets a single squashed commit** with a clear message.
- **Read `docs/RESEARCH.md` if you're ever unsure about the why.** It's the canonical reference.

---

## Follow-ups (deferred detail from shipped/in-progress milestones)

Concrete work consciously scoped *out* of a milestone so it could be checked
off, but that we intend to come back to. Distinct from "Open ideas" below —
these are known gaps in code that already exists, not speculative features.

- **Tool block rich rendering** (`packages/tui/src/components/transcript.ts`,
  `tool` case). M3 ships a minimal status line only (`✓ / ✗ / ⋯` glyph +
  tool name, colored by status). Deferred per `TUI-DESIGN.md §4.5`: rendering
  the `result` body, collapse-to-first-3-lines, `… (N more)` truncation
  indicator, live partial-output display during `running`, and
  expand-on-demand. The block model already stores `result`/`input`, so this
  is display-only — no type or mutator changes needed.
- **Error message continuation indent** (`transcript.ts`, `error` case).
  Wrapped error messages put the `✗ ` marker only on the first line;
  continuation lines start at column 0 instead of indenting 2 spaces to align
  under the message text. Same continuation-indent pattern as the input box.
- **Move `smoke-input-box.ts` out of `src/`.** Currently at
  `packages/tui/src/scripts/input-box.ts`, so `tsc` compiles it into `dist/`.
  Move to `packages/tui/scripts/` (sibling of `src/`) to match the other
  smoke scripts and keep `dist/` clean.
- **Theme `dim` redundancy** (`packages/tui/src/theme/`). `dim` exists as both
  an `FgRole` (so `theme.fg("dim")` works) *and* a standalone `theme.dim()`
  method — two spellings for the same `\x1b[2m` escape. Pick one; convention so
  far is `theme.dim()`.
- **Extract `wrapText` to a shared util.** Now duplicated across
  `transcript.ts` and `permission-prompt.ts` (`input-box.ts` has its own
  `wrapBuffer` with cursor math — leave that separate). Three consumers
  exists when permission-prompt's smoke test lands; that's the canonical
  "extract" threshold. Suggested home: `packages/tui/src/util/text.ts`.
- **`PermissionPrompt.cancel(reason)` method.** Currently the prompt never
  rejects its Promise — all paths resolve (Enter → choice, Esc → `"no"`).
  External cancellation (Ctrl-C while prompt active, `stop` event mid-prompt,
  TUI teardown) has no graceful path; the pending Promise hangs forever
  until the process exits. Add a `cancel(reason: string)` method that
  rejects + clears, plus a `rejector` field captured in `show()`. Needed
  once M3.7 wires the `stop` event handler or M3.6 routes Ctrl-C.

---

## Open ideas (parked — promote when ready)

- **Swap `tsc` → `tsgo`** once tsgo has stabilized (canonical npm name + non-beta release). Build/typecheck scripts in each package would change in lockstep.
- Claude Code-style extensibility (skills, slash commands, hooks)
- nvim-mode for long input writes
- Cost/token display in status bar
- Local-first model support (Ollama, Qwen3-Coder-Next)
- `cog serve` for headless / remote mode
- MCP support
- Plugin system
