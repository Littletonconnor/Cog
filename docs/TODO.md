# Cog — TODO

> **Current milestone: M2 — StreamEvent contract + mock provider.**
> Work top to bottom. Check items as you complete them.
> M0 and M1 are done.

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

- [ ] Single commit: `feat(providers): M2 StreamEvent contract + MockProvider with scripted JSON scenarios`

---

## M3 — Bare TUI against the mock

(Detailed checklist drops after M2.)

---

## M4 — TUI polish

- Token / cost display in status bar
- Multi-line input (Shift+Enter)
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

## Open ideas (parked — promote when ready)

- **Swap `tsc` → `tsgo`** once tsgo has stabilized (canonical npm name + non-beta release). Build/typecheck scripts in each package would change in lockstep.
- Claude Code-style extensibility (skills, slash commands, hooks)
- nvim-mode for long input writes
- Cost/token display in status bar
- Local-first model support (Ollama, Qwen3-Coder-Next)
- `cog serve` for headless / remote mode
- MCP support
- Plugin system
