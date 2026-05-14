# tools

Built-in tools the agent can call: `read_file`, `write_file`, `edit_file`, `bash`, `grep`, `glob`, plus `todo_read` / `todo_write`. Each tool is a typed function (`{ schema, run }`) registered into a plain map. Tools never import from `agent` or `providers` — the runtime injects everything they need (abort signal, metadata channel, permission asker) via a context object.

**No internal package dependencies.** See [`docs/RESEARCH.md §5`](../../docs/RESEARCH.md) for the canonical tool catalogue and design lessons (SWE-agent's "lint after edit" rule, Anthropic's "Writing Tools for Agents" guide).
