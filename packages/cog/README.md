# cog

The CLI entry point — the `cog` binary you run from your terminal. Wires the agent loop, the provider, and the TUI together; parses CLI args via `node:util.parseArgs`; loads project config (`COG.md` / `AGENTS.md` / `CLAUDE.md`) and session state; resolves the model and provider for each session.

**Depends on:** `agent`, `tui`, `providers`. The only package with a `bin` field — that's what makes `cog` a binary on your PATH after `pnpm link`.
