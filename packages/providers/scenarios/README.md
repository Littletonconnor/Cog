# Scenarios

JSON files that script a `StreamEvent` sequence for `MockProvider` to replay. Each scenario simulates one assistant turn — from "thinking" through to a final `stop` event. The mock reads the file, waits `delayMs` before each event, then yields it.

Scenarios are demo material (drive `cog --mock <path>`) and will later serve as test fixtures once vitest comes online after M3.

## File format

Top-level shape (typed as `ScenarioFile` in `../src/types.ts`):

```ts
type ScenarioFile = {
  name: string;             // short id, usually the filename without .json
  description: string;      // one-line summary of what this exercises
  events: ScenarioEvent[];  // ordered list of events to emit
};

type ScenarioEvent = StreamEvent & { delayMs?: number };
```

Each event is a `StreamEvent` (see `../src/types.ts` for the 10 variants) plus an optional `delayMs` — the milliseconds the mock waits **before** emitting that event. Defaults to `0`.

Realistic delay buckets:

| What                                 | Delay        |
| ------------------------------------ | ------------ |
| Brief "thinking" warm-up before TTFT | ~200ms       |
| Time-to-first-token (TTFT)           | ~300–500ms   |
| Between streamed text tokens         | ~50–150ms    |
| Tool start → tool end (small tool)   | ~500–1000ms  |
| Tool start → tool end (slow tool)    | ~1500–3000ms |
| Compaction duration                  | ~1500ms      |

## Conventions

- **End every scenario with a `stop` event.** The mock will error at load time if the last event isn't `stop` — keeps the lifecycle obvious and prevents silently-truncated fixtures.
- **Wrap each phase in `status_change` events:**
  - `{ active: "thinking" }` while text is being produced.
  - `{ active: "<tool_name>" }` while a tool is running.
  - `{ active: null }` immediately before the terminal `stop`.
- **Tool IDs:** `tool_01`, `tool_02`, … Only the relative ordering matters; the strings are opaque to the agent loop.
- **`isError` is required on `tool_use_end`** even for the happy path (`isError: false`). No defaulting — explicit is safer for fixtures.
- **One assistant turn per file.** Don't chain multiple user-and-assistant turns in one scenario. If you need that, write a higher-level test harness.

## Canonical scenarios (M2.4)

| File              | What it exercises                                              |
| ----------------- | -------------------------------------------------------------- |
| `hello.json`      | Simplest text stream (TUI §4.3). Smoke test.                   |
| `tool-call.json`  | Full tool block lifecycle (§4.4 → §4.5)                        |
| `permission.json` | Inline permission prompt + assumed approval (§4.7)             |
| `error.json`      | Recoverable mid-stream error (§4.11)                           |
| `compaction.json` | Compaction indicator before reply (§4.14)                      |

## Example: hello.json

```json
{
  "name": "hello",
  "description": "Simplest scenario: thinking status, short streamed reply, stop.",
  "events": [
    { "delayMs": 200, "type": "status_change", "active": "thinking" },
    { "delayMs": 400, "type": "text_delta", "delta": "Hello! " },
    { "delayMs": 80,  "type": "text_delta", "delta": "How can I help?" },
    { "delayMs": 100, "type": "status_change", "active": null },
    { "delayMs": 0,   "type": "stop", "reason": "finished" }
  ]
}
```

## Adding a new scenario

1. Create `scenarios/<name>.json` with `name`, `description`, and `events`.
2. Hand-write or copy the closest existing scenario and adapt.
3. Run it: `cog --mock packages/providers/scenarios/<name>.json` — should print each event with realistic delays to stdout.
4. If you change the `StreamEvent` shape in `../src/types.ts`, the mock loader (once typed via `ScenarioFile` in M2.3) will fail to parse any scenario referencing a deleted field. Update scenarios in lockstep.

## Why JSON and not TypeScript?

- **Editable without rebuild.** Tweak a delay, re-run the mock — no `pnpm build`.
- **Easy to record from real providers later.** Once the Anthropic provider lands, we can pipe a real session into a JSON file to make a regression fixture.
- **Forces the loader to handle invalid input.** Same code path as eventually consuming third-party / user-provided scenarios.
