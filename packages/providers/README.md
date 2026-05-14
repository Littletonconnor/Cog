# providers

LLM provider clients for Cog. Each provider implements one interface: `stream(messages, tools, model) → AsyncIterable<StreamEvent>`. v1 ships a `MockProvider` (scripted JSON scenarios — see M2) and later a real Anthropic client. Future drop-in providers (OpenAI-compatible, etc.) share the same shape.

**No internal package dependencies.** The `StreamEvent` contract lives here and is the load-bearing seam between the model layer and everything that renders or reasons about model output (the agent loop, the TUI). See [`docs/RESEARCH.md §4`](../../docs/RESEARCH.md) and [`docs/RESEARCH.md §8`](../../docs/RESEARCH.md).
