# agent

The agent loop, session state, and tool registry. The loop is small (~10 lines of substantive logic): stream the next assistant message, collect tool calls, dispatch them, append results, repeat until the model stops requesting tools. Owns context compaction, abort signaling, and the typed event stream the TUI consumes.

**Depends on:** `tools` (the built-in tool registry) and `providers` (for the `StreamEvent` and `Provider` interfaces only — never a concrete provider). See [`docs/RESEARCH.md §3`](../../docs/RESEARCH.md) for the loop design and [`docs/RESEARCH.md §6`](../../docs/RESEARCH.md) for the session model.
