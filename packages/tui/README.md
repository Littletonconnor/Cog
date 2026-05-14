# tui

Terminal UI primitives for Cog: a differential renderer that diffs `string[]` frames line-by-line, raw-mode keyboard handling, ANSI helpers, and the component set (transcript, input box, status bar, slash command palette, permission prompt). Modeled on `pi-tui` — see [`docs/RESEARCH.md §2`](../../docs/RESEARCH.md) and [`docs/TUI-DESIGN.md`](../../docs/TUI-DESIGN.md).

**No internal package dependencies.** Pure runtime: Node builtins and ANSI escape codes only. The TUI consumes a `StreamEvent` async iterable (whose shape is defined in `providers`) and renders it.
