# Industry References for Building a Coding Agent

A curated reading list and synthesis of public writing on production coding agents, assembled to inform the design of **Cog**. Sources span 2024–2026. Each entry includes the URL, key insights, direct quotes worth referencing, and how it informs Cog's design.

> **How to read this doc.** Skim the table of contents, follow links for primary reading, then read the **Patterns Synthesis** section at the bottom — that's the distilled "what every coding agent has converged on."

## Table of Contents

1. [Anthropic — Building Effective Agents](#1-anthropic--building-effective-agents)
2. [Anthropic — Writing Effective Tools for Agents](#2-anthropic--writing-effective-tools-for-agents)
3. [Anthropic — Effective Context Engineering for AI Agents](#3-anthropic--effective-context-engineering-for-ai-agents)
4. [Anthropic — Claude Code Sandboxing](#4-anthropic--claude-code-sandboxing)
5. [Anthropic — Harness Design for Long-Running Agents](#5-anthropic--harness-design-for-long-running-agents)
6. [Anthropic — Prompt Caching](#6-anthropic--prompt-caching)
7. [Cognition — Don't Build Multi-Agents](#7-cognition--dont-build-multi-agents)
8. [OpenAI — Codex CLI Architecture](#8-openai--codex-cli-architecture)
9. [Aider — Repository Map & Edit Formats](#9-aider--repository-map--edit-formats)
10. [SWE-agent — Agent-Computer Interface](#10-swe-agent--agent-computer-interface)
11. [Cursor — Architecture & Agent Mode](#11-cursor--architecture--agent-mode)
12. [Cline / Roo Code](#12-cline--roo-code)
13. [OpenHands (OpenDevin)](#13-openhands-opendevin)
14. [HuggingFace smolagents](#14-huggingface-smolagents)
15. [AWS Strands Agents SDK](#15-aws-strands-agents-sdk)
16. [Simon Willison — Tools in a Loop / Designing Agentic Loops](#16-simon-willison--tools-in-a-loop--designing-agentic-loops)
17. [Hamel Husain — A Field Guide to Rapidly Improving AI Products](#17-hamel-husain--a-field-guide-to-rapidly-improving-ai-products)
18. [Geoffrey Litt — Coding Like a Surgeon](#18-geoffrey-litt--coding-like-a-surgeon)
19. [Eugene Yan — Patterns for Building LLM Systems](#19-eugene-yan--patterns-for-building-llm-systems)
20. [Model Landscape — Frontier & Open-Weights](#20-model-landscape--frontier--open-weights)
21. [**Patterns Synthesis**](#patterns-synthesis)

---

## 1. Anthropic — Building Effective Agents

- **URL:** https://www.anthropic.com/research/building-effective-agents
- **Author:** Erik Schluntz & Barry Zhang, Anthropic
- **Year:** 2024 (canonical reference, still cited heavily through 2026)

### Key Insights

1. **Workflow vs. Agent distinction.** "Workflows are systems where LLMs and tools are orchestrated through predefined code paths." "Agents are systems where LLMs dynamically direct their own processes and tool usage, maintaining control over how they accomplish tasks." Use workflows when the task is predictable; use agents only when flexibility is required.
2. **Named patterns.** Prompt chaining, routing, parallelization (sectioning + voting), orchestrator-workers, evaluator-optimizer, agents. A coding agent typically combines orchestrator-workers (planner → executor) and evaluator-optimizer (generator → test runner → feedback).
3. **Agent-Computer Interface (ACI) as a discipline.** Tools deserve the same care as any human-computer interface: give the model room to think, prefer formats common in pretraining data, document edge cases, apply poka-yoke (mistake-proofing).
4. **Simplicity bias.** Most production agents are simpler than the literature suggests. "Maintain simplicity in agent design."
5. **Ground truth from the environment.** Agents "gain ground truth from the environment at each step (such as tool call results or code execution)."

### Quotes

> "Agents are systems where LLMs dynamically direct their own processes and tool usage, maintaining control over how they accomplish tasks." — Schluntz & Zhang

> "Give the model enough tokens to 'think' before it writes itself into a corner." — Schluntz & Zhang

### Informs Cog

- **Agent loop:** Build the simplest possible while-loop first; don't reach for multi-agent orchestration until measurement says we need it.
- **Tool design:** Treat tool specs as a UI surface — name, description, parameter shape, and error messages all matter.
- **Pattern selection:** A coding agent for a single developer is the "Agents" pattern with a sprinkle of "evaluator-optimizer" (run tests, feed failures back).

---

## 2. Anthropic — Writing Effective Tools for Agents

- **URL:** https://www.anthropic.com/engineering/writing-tools-for-agents
- **Year:** 2025

### Key Insights

1. **Three-step iterative methodology:** Prototype → Evaluate → Collaborate. Build a quick MCP/desktop prototype, run dozens of realistic eval tasks with verifiable outcomes, then feed transcripts back into Claude to refactor the tools.
2. **Five design principles:**
   - **Choose the right tools.** Don't wrap every API endpoint. Consolidate multi-step flows (e.g., a single `schedule_event` instead of `list_users` + `create_event`).
   - **Namespace tools.** Use prefixes like `asana_search`, `jira_search`. Prefix vs. suffix choice produces measurable differences and varies by model.
   - **Return meaningful context.** Human-readable IDs over UUIDs. Expose a `response_format` enum (`detailed` vs. `concise`).
   - **Optimize for token efficiency.** Default response cap (Claude Code uses 25,000 tokens). Paginate, filter, range-select, truncate.
   - **Prompt-engineer descriptions.** "Even small refinements to tool descriptions can yield dramatic improvements."
3. **Tools are a contract** between deterministic systems and non-deterministic agents.
4. **High-signal over low-signal fields.** Strip `uuid`, `mime_type`, technical IDs from responses unless the agent will actually use them.
5. **Helpful truncation messages.** Don't return an opaque error; return guidance like "result truncated — try a narrower filter."

### Quotes

> "Tools are a new kind of software which reflects a contract between deterministic systems and non-deterministic agents."

> "LLM agents have limited 'context,' whereas computer memory is cheap and abundant."

> "Agents are only as effective as the tools we give them."

### Informs Cog

- **Tool catalogue design:** Each tool spec should be reviewed like an API doc, with explicit examples and edge cases in the description.
- **Token budget:** Cap tool responses (~25k tokens), paginate large outputs, never dump full file contents without a range parameter.
- **Eval-driven tool refinement:** Build a small eval harness early and tune tool descriptions against it.

---

## 3. Anthropic — Effective Context Engineering for AI Agents

- **URL:** https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents
- **Year:** 2025

### Key Insights

1. **Context engineering ≠ prompt engineering.** Prompt engineering is one-shot. Context engineering is "strategies for curating and maintaining the optimal set of tokens (information) during LLM inference" — a cyclic, iterative process.
2. **Context is a finite resource with diminishing returns.** More tokens past a threshold harm accuracy.
3. **System prompt altitude.** Write prompts at the "right altitude" — specific enough to guide, flexible enough to avoid brittleness.
4. **Tool overlap rule.** "If a human engineer can't definitively say which tool should be used in a given situation, an AI agent can't be expected to do better."
5. **Three compaction strategies for long horizons:**
   - **Compaction proper** — summarize history, reinitiate. Tune the compaction prompt for recall first, then precision.
   - **Structured note-taking** — agent writes `NOTES.md` and reloads it.
   - **Sub-agent architectures** — specialized subagents return condensed summaries.
6. **Just-in-time retrieval.** Instead of pre-loading data, keep lightweight identifiers (paths, queries) and load on demand.

### Quotes

> "Context, therefore, must be treated as a finite resource with diminishing marginal returns."

> "Good context engineering means finding the *smallest possible* set of high-signal tokens that maximize the likelihood of some desired outcome."

> "'Do the simplest thing that works' will likely remain our best advice for teams building agents on top of Claude."

### Informs Cog

- **System prompt:** Keep it concise but include the right altitude of guidance (style preferences, environment info, when-to-ask-vs-act).
- **History management:** Don't try to keep everything; design compaction triggers early (e.g., at 70% of context window).
- **Sub-agents for focused work:** Use sub-agents only when the surface area is well-bounded (search, read large files, summarize) — *not* for ambiguous coordinated tasks.

---

## 4. Anthropic — Claude Code Sandboxing

- **URL:** https://www.anthropic.com/engineering/claude-code-sandboxing
- **Year:** 2025

### Key Insights

1. **Two isolation boundaries:** filesystem (restricted to CWD) and network (proxy with domain allowlist). Both are necessary — neither alone is sufficient.
2. **Platform primitives:** Linux **bubblewrap**, macOS **seatbelt**. These enforce restrictions on Claude *and* every spawned subprocess.
3. **Threat model = prompt injection.** Even if a prompt injection succeeds, the blast radius is bounded.
4. **Permission UX as a feature.** Internal testing shows sandboxing reduces permission prompts by 84%, which mitigates "approval fatigue."

### Quotes

> "Sandboxing ensures that even a successful prompt injection is fully isolated, and cannot impact overall user security."

> "Without network isolation, a compromised agent could exfiltrate sensitive files like SSH keys; without filesystem isolation, a compromised agent could escape."

### Informs Cog

- **Sandbox first, permissions second.** If we trust the sandbox, we can YOLO most reads/writes inside it.
- **Use OS primitives.** Don't roll our own sandbox — wrap bubblewrap/seatbelt or use a container.
- **Network proxy with allowlist.** Block all outbound traffic except explicitly allowed domains (npm registry, GitHub, etc.).

---

## 5. Anthropic — Harness Design for Long-Running Agents

- **URL:** https://www.anthropic.com/engineering/harness-design-long-running-apps
- **Year:** 2025

### Key Insights

1. **The "harness" is the scaffolding around the model** — the agent loop, tool plumbing, context manager, permission gates. "Every component in a harness encodes an assumption about what the model can't do on its own."
2. **Context resets vs. compaction.** Compaction summarizes in-place. Resets clear the window with a structured handoff artifact. Sonnet 4.5 needed resets due to "context anxiety"; Opus 4.5 largely eliminated this need.
3. **Three-agent pattern for long horizons:** Planner (ambition over granularity) → Generator (implements + self-evals) → Evaluator (Playwright MCP, tests against sprint contracts). Agents communicate via files, not inline conversation.
4. **External evaluation beats self-evaluation.** "Separating the agent doing the work from the agent judging it proves to be a strong lever."
5. **Self-evaluation is unreliable.** Generators "respond by confidently praising the work — even when, to a human observer, the quality is obviously mediocre."

### Quotes

> "Every component in a harness encodes an assumption about what the model can't do on its own, and those assumptions are worth stress testing."

> "Models tend to lose coherence on lengthy tasks as the context window fills."

### Informs Cog

- **Harness as a versioned artifact.** Treat the agent loop + tool definitions as code, not config. Test it.
- **Compaction trigger:** Watch context fill; offer either compaction or a clean handoff with a "state file."
- **External evaluator only if needed.** For a minimal agent we can defer the evaluator — tests + lint + the developer themselves are the evaluator.

---

## 6. Anthropic — Prompt Caching

- **URL:** https://docs.anthropic.com/en/docs/build-with-claude/prompt-caching
- **Also:** https://www.anthropic.com/news/prompt-caching
- **Year:** 2024 (caching shipped), still evolving in 2025–2026

### Key Insights

1. **90% input cost reduction on cache hits**, up to 85% latency reduction for long prompts.
2. **Cache is prefix-only.** Static content must come first; dynamic content last. Any change invalidates everything after.
3. **TTL options:** 5-minute (write cost 1.25× input) or 1-hour (write cost 2.0× input).
4. **What to cache for a coding agent:** system prompt, tool definitions, environment description (CWD, OS, shell), repo map. New user input is never cached.
5. **Agent-specific gotcha:** "Tool results often contain user-specific data that will not benefit other sessions, and the interleaving of static system prompts with dynamic tool outputs complicates cache reuse."

### Informs Cog

- **Prompt layout (top to bottom):** [cached: system prompt → tool defs → env info → repo map] → [uncached: conversation → tool results].
- **Don't rebuild the prompt mid-session.** Treat the prefix as immutable; only append.
- **Mark cache breakpoints explicitly** with `cache_control`.

---

## 7. Cognition — Don't Build Multi-Agents

- **URL:** https://cognition.ai/blog/dont-build-multi-agents
- **Author:** Walden Yan, Cognition Labs (Devin)
- **Year:** 2025

### Key Insights

1. **Parallel multi-agent systems are fragile** because they fragment decision-making. Subagents make conflicting assumptions; a coordinator can't reconcile them post-hoc.
2. **Two principles:**
   - **Share context** — "Share context, and share full agent traces, not just individual messages."
   - **Actions carry implicit decisions** — and "conflicting decisions carry bad results."
3. **Devin's approach:** sequential subtasks, never parallel. Subagents used only to answer well-defined questions (e.g., "search this codebase for X"), never to make decisions.
4. **Long-running solution:** a specialized "context compression" LLM that distills traces into key decisions and events.

### Quotes

> "Share context, and share full agent traces, not just individual messages."

> "Actions carry implicit decisions, and conflicting decisions carry bad results."

### Informs Cog

- **Default to single-agent.** Sub-agents only for bounded, read-only tasks.
- **If we sub-agent, share full context.** Pass the parent's relevant history, not just a task description.
- **Compaction is a first-class component**, not an afterthought.

---

## 8. OpenAI — Codex CLI Architecture

- **URL:** https://github.com/openai/codex
- **Architecture writeup:** https://www.zenml.io/llmops-database/building-production-ready-ai-agents-openai-codex-cli-architecture-and-agent-loop-design
- **Docs:** https://developers.openai.com/codex/cli
- **Year:** 2025 (Rust rewrite, April 2025)

### Key Insights

1. **Rust binary for speed.** Codex CLI is open source and built in Rust.
2. **Stateless requests via Responses API.** Codex deliberately avoids `previous_response_id` and sends the full conversation each turn to support Zero Data Retention.
3. **Prompt structure (server-side resolution order):** system message → tools → instructions → user input. Static-first for cache efficiency.
4. **Three tool sources:** Codex-provided (sandboxed shell), API-provided (Responses API native), MCP (not sandboxed by Codex).
5. **Compaction via `/responses/compact`.** Server-side endpoint replaces long histories with compressed representations as token limits approach.
6. **Hundreds of tool calls per turn.** "A single turn can involve many iterations between model inference and tool execution."

### Quotes

> "With cache hits, sampling becomes linear rather than quadratic. Cache hits only occur for exact prefix matches within prompts, so structuring prompts with static content like instructions and examples at the beginning and variable content like user-specific information at the end is essential for cache efficiency."

> "An agent making hundreds of tool calls in a single turn could potentially exhaust this window, making context management a critical production concern."

### Informs Cog

- **Stateless server design.** Send full history each turn; client owns state.
- **Prefix-stable prompts.** Never edit earlier turns — only append.
- **Per-turn tool budgets.** Cap tool calls per turn or warn when it approaches a threshold.

---

## 9. Aider — Repository Map & Edit Formats

- **Docs:** https://aider.chat/docs/repomap.html
- **Original blog:** https://aider.chat/2023/10/22/repomap.html
- **Source:** https://github.com/Aider-AI/aider/blob/main/aider/repomap.py
- **Author:** Paul Gauthier
- **Year:** 2023–2025 (continuously updated)

### Key Insights

1. **Repo map = AST signatures, not embeddings.** Aider parses every file with **tree-sitter** (via `py-tree-sitter-languages`), extracts function/class/variable signatures, and feeds them to the model.
2. **Graph ranking to fit a token budget.** Files are nodes; dependencies are edges. A graph-ranking algorithm (PageRank-style) selects which signatures fit within `--map-tokens` (default 1,000).
3. **Dynamic sizing.** "Aider adjusts the size of the repo map dynamically based on the state of the chat" — expands when no files are explicitly added; contracts when many files are loaded.
4. **Edit formats.** Aider experimented extensively with whole-file, unified diff, and SEARCH/REPLACE block formats. SEARCH/REPLACE is now standard for capable models. Format choice has measurable impact on benchmark scores.
5. **Why signatures, not embeddings:** signatures are *deterministic*, cheaper, and don't require re-indexing on every edit.

### Quotes

> "The LLM can see classes, methods and function signatures from everywhere in the repo. This alone may give it enough context to solve many tasks." — Paul Gauthier

### Informs Cog

- **Start with AST signatures, not embeddings.** Tree-sitter is good enough for the first version; embeddings are an optimization, not a requirement.
- **Map tokens are a budget.** Make the map size configurable; default ~1k tokens.
- **Edit format = SEARCH/REPLACE blocks** for any model strong enough (Claude Sonnet 4+, GPT-5+). Fall back to whole-file for weaker models.

---

## 10. SWE-agent — Agent-Computer Interface

- **Paper:** https://arxiv.org/abs/2405.15793 (NeurIPS 2024)
- **Code:** https://github.com/SWE-agent/SWE-agent
- **Docs:** https://swe-agent.com/
- **Authors:** John Yang, Carlos Jimenez, Alexander Wettig, Kilian Lieret, Shunyu Yao, Karthik Narasimhan, Ofir Press (Princeton)

### Key Insights

1. **The ACI (Agent-Computer Interface) thesis:** "LM agents benefit from specially-designed interfaces, just as humans benefit from integrated development environments." Don't hand the agent raw bash.
2. **Custom commands beat raw bash.** SWE-agent provides a curated set (file viewer with line numbers, edit command with linting, search, navigation) tailored to LM strengths.
3. **Edit-with-linting:** After an edit, immediately run a linter; if it fails, reject the edit and show the error. Prevents the agent from drifting into syntactically broken states.
4. **State-of-the-art on SWE-bench (at publication):** 12.5% pass@1, vs. ~4% for non-interactive baselines.
5. **Interface design as a first-class research direction**, not just prompting.

### Quotes

> "LM agents benefit from specially-designed interfaces, just as humans benefit from integrated development environments." — Yang et al.

### Informs Cog

- **Don't give Claude raw bash and call it a day.** Provide curated tools (read_file with line numbers, edit with linter, scoped search, scoped list).
- **Linter-in-the-loop.** After every edit, run a fast syntax check; surface failures immediately so the agent self-corrects.
- **File viewer with line numbers + scroll.** Line numbers in `read_file` output are non-negotiable.

---

## 11. Cursor — Architecture & Agent Mode

- **Architecture writeup:** https://blog.sshh.io/p/how-cursor-ai-ide-works (Shrivu Shankar)
- **Cursor 2.0 + Composer:** https://www.artezio.com/pressroom/blog/revolutionizes-architecture-proprietary/
- **Cursor 3 agent-first:** https://www.infoq.com/news/2026/04/cursor-3-agent-first-interface/

### Key Insights

1. **VSCode fork + agent loop + tools.** "To build an AI IDE, you: Fork VSCode, add a chat UI and pick a good LLM, implement tools for the coding agent, optimize the internal prompts."
2. **Two-stage retrieval:** embedding-based candidate selection, then a re-ranking LLM. Code comments and docstrings disproportionately shape embeddings.
3. **Semantic diffs + cheap apply model.** The main agent writes a fuzzy "semantic diff"; a cheaper, faster apply model converts it into a real file edit. Splits the cost of "thinking what to change" from "writing the bytes."
4. **System prompt rules** (extracted from Cursor's leaked prompt):
   - "NEVER refer to tool names when speaking [to the user]"
   - "you MUST read the contents or section of what you're editing before editing it"
   - "DO NOT loop more than 3 times on fixing linter errors"
   - "Address the root cause instead of the symptoms"
5. **Rules as encyclopedia, not commands.** Project-level rules work better when descriptive and searchable than when prescriptive.
6. **Agent-first UX (Cursor 3, 2026):** parallel agents, local-to-cloud handoff, plugin marketplace. Tab completion usage is now half of agent usage — a reversal from early 2025.

### Quotes

> "Code comments and doc-strings guide the embedding model which make them much more important than if they were just for fellow humans." — Shrivu Shankar

> "Cursor's effectiveness stems from careful decomposition of coding tasks across specialized models, intelligent context retrieval, and prompts that acknowledge LLM limitations while steering around them." — Shrivu Shankar

### Informs Cog

- **Specialize model use:** main loop on Sonnet/Opus, file-apply on Haiku, embedding/rerank on a cheap embed model.
- **Rules system:** allow `AGENTS.md` / `CLAUDE.md` style files that the agent reads opportunistically.
- **Prompt hygiene:** include lint-loop limits ("don't loop more than 3 times"), edit-then-verify rules, and a ban on naming tools in user-facing output.

---

## 12. Cline / Roo Code

- **Cline:** https://github.com/cline/cline
- **Roo Code:** https://github.com/RooCodeInc/Roo-Code
- **Comparison:** https://www.qodo.ai/blog/roo-code-vs-cline/

### Key Insights

1. **Cline = command-by-command human approval.** Every action requires explicit approval before execution. High safety, low autonomy.
2. **Roo Code = forked Cline + custom modes + diff edits.** Five built-in modes (Code, Architect, Ask, Debug, Custom) and a community gallery. Modes are essentially scoped system prompts + tool subsets.
3. **Repo indexing at startup** (Cline). Maps file relationships, dependencies, call hierarchies. Roo defers indexing — it respects what the developer has put in context.
4. **MCP-native.** Both treat MCP as the primary plugin mechanism.
5. **Browser + terminal tools** are common.

### Informs Cog

- **Modes are useful.** Even for a minimal agent, having a "read-only mode" and a "full-edit mode" is cheap and high-value.
- **Approval policy as a config knob:** auto / per-tool / per-action. Sensible defaults: auto for reads, ask for writes outside CWD, never for network requests outside allowlist.

---

## 13. OpenHands (OpenDevin)

- **Paper:** https://arxiv.org/abs/2407.16741 (ICLR 2025)
- **HTML version:** https://arxiv.org/html/2407.16741v3
- **Repo:** https://github.com/All-Hands-AI/OpenHands
- **SDK paper (2025):** https://arxiv.org/html/2511.03690v1

### Key Insights

1. **Event-stream architecture.** State = chronological list of Actions and Observations. This is the abstraction that lets you serialize an agent, hand it off, or rewind.
2. **Action types:**
   - `IPythonRunCellAction` (Python REPL)
   - `CmdRunAction` (bash)
   - `BrowserInteractiveAction` (BrowserGym DSL)
   - `AgentDelegateAction` (sub-agent dispatch)
3. **AgentSkills library** — explicit higher-level tools: `edit_file` (line-range edits), `scroll_up`/`scroll_down`, `parse_image`, `parse_pdf`. Philosophy: include skills "where it is not readily achievable for LLM to write code directly."
4. **Docker sandbox runtime** with bash, IPython, and Playwright Chromium.
5. **CodeActAgent** = generalist default. Either converses or "performs the task by executing code (a.k.a., CodeAct)."

### Informs Cog

- **Event stream over flat messages.** Model the agent's history as Actions + Observations from day one. Easier to serialize, replay, debug, and compact.
- **Pick an Action vocabulary early:** `RunCommand`, `EditFile`, `ReadFile`, `Search`, `Finish`. Resist adding more until you have evidence.
- **Docker as the canonical runtime,** with a thin local-mode for trusted dev environments.

---

## 14. HuggingFace smolagents

- **Repo:** https://github.com/huggingface/smolagents
- **Launch post:** https://huggingface.co/blog/smolagents
- **Year:** 2025

### Key Insights

1. **<1,000 lines for the core agent.** Deliberate minimalism. A great reference for "how small can a real agent be?"
2. **Code agents > tool-calling agents.** Empirical claim: code agents take 30% fewer steps and score higher on hard benchmarks.
3. **The agent loop, in 4 lines:**
   ```python
   memory = [user_defined_task]
   while llm_should_continue(memory):
       action = llm_get_next_action(memory)
       observations = execute_action(action)
       memory += [action, observations]
   ```
4. **Sandboxes:** E2B, Modal, Docker, Pyodide + Deno WebAssembly. Choose by trust + cost.
5. **Model-agnostic via LiteLLM.** Local (transformers, Ollama), API (OpenAI, Anthropic), or HF Hub.

### Quotes

> "AI Agents are programs where LLM outputs control the workflow." — smolagents launch post

> "We crafted our code languages specifically to be the best possible way to express actions performed by a computer. If JSON snippets were a better expression, JSON would be the top programming language and programming would be hell on earth." — smolagents launch post

> "For the sake of simplicity and robustness, it's advised to regularize towards not using any agentic behaviour" — smolagents

### Informs Cog

- **The agent loop is genuinely small.** Don't over-engineer it. The complexity is in tools, context, and sandbox — not the loop.
- **Consider code-as-action.** Even if the primary surface is JSON tool calls, allow a `run_python` or `run_shell` escape hatch.
- **Pyodide + Deno** is an interesting WASM sandbox option for safe-by-default Python/JS execution.

---

## 15. AWS Strands Agents SDK

- **Launch:** https://aws.amazon.com/blogs/opensource/introducing-strands-agents-an-open-source-ai-agents-sdk/
- **Deep dive:** https://aws.amazon.com/blogs/machine-learning/strands-agents-sdk-a-technical-deep-dive-into-agent-architectures-and-observability/
- **Site:** https://strandsagents.com/
- **Year:** 2025

### Key Insights

1. **Three components: model + system prompt + tools.** That's the entire agent abstraction.
2. **Model-driven, not workflow-driven.** "Some of the agent framework libraries we had been using to build our agents started to get in our way of fully leveraging the capabilities of newer LLMs." — Clare Liguori. Strands removes the DAG.
3. **Tools via `@tool` decorator or MCP.** Same surface for both.
4. **OpenTelemetry-native observability.** Every step emits OTEL spans; backends like Jaeger, Honeycomb, Datadog work out of the box.
5. **Long-running tasks via AgentCore** (Bedrock service). Up to 8 hours; asynchronous tool execution.

### Quotes

> "A model-driven approach to building and running AI agents in just a few lines of code." — Strands launch post

### Informs Cog

- **Three-component mental model:** This is the right abstraction for Cog's user-facing API.
- **Observability from day one.** Wrap each model call and tool call in OTEL spans. Cheap to add early; painful to retrofit.
- **No DAGs.** Resist the urge to add a workflow builder.

---

## 16. Simon Willison — Tools in a Loop / Designing Agentic Loops

- **"Agents are models using tools in a loop":** https://simonwillison.net/2025/May/22/tools-in-a-loop/
- **"Designing agentic loops":** https://simonw.substack.com/p/designing-agentic-loops
- **"I think 'agent' may finally have a definition":** https://simonw.substack.com/p/i-think-agent-may-finally-have-a
- **Year:** 2025

### Key Insights

1. **The consensus definition:** "An LLM agent runs tools in a loop to achieve a goal." (Originally attributed to Anthropic's Hannah Moran, championed by Willison.)
2. **"Designing agentic loops" is a new skill.** Coding agents are brute-force solvers; success = clear goals + good tools + good feedback.
3. **YOLO mode mitigations:** (1) container sandbox (Docker, Apple container), (2) remote execution (Codespaces, Code Interpreter), (3) accept the risk. Willison prefers (2).
4. **AGENTS.md beats MCP for most cases.** Standard CLI tools + docs in a project file > custom MCP integrations.
5. **Problem-fit indicator:** "ugh, I'm going to have to try a lot of variations here" = good agentic-loop candidate.

### Quotes

> "An AI agent is an LLM wrecking its environment in a loop." — Solomon Hykes (quoted by Willison)

> "Designing agentic loops is a very new skill — Claude Code was first released just February 2025!" — Willison

### Informs Cog

- **AGENTS.md as a first-class config file.** Document the project's commands, conventions, and test-running scripts there; have Cog auto-read it.
- **Default to container sandbox.** Even for local use, a Docker dev environment is a strong default.
- **The loop is the whole point.** Make iteration cheap: fast tools, fast feedback, fast retries.

---

## 17. Hamel Husain — A Field Guide to Rapidly Improving AI Products

- **URL:** https://hamel.dev/blog/posts/field-guide/
- **O'Reilly mirror:** https://www.oreilly.com/radar/a-field-guide-to-rapidly-improving-ai-products/
- **Year:** 2025

### Key Insights

1. **Successful teams obsess over measurement, not tools.** "Teams that succeed barely talk about tools at all."
2. **Binary pass/fail + critique > multi-point scale.** Multi-point scales create ambiguity at the margin.
3. **Error analysis is bottom-up:**
   - Inspect actual outputs
   - Write open-ended notes
   - Cluster into a failure taxonomy (LLM-assisted)
   - Count frequencies
   - Prioritize by impact
4. **NurtureBoss case:** 3 failure categories accounted for 60% of problems. Without error analysis you can't see this.
5. **Synthetic eval data:** LLMs generate diverse user inputs grounded in real DB samples. Validate that synthetic cases actually trigger the intended scenario.

### Quotes

> "LLMs are surprisingly good at generating excellent — and diverse — examples of user prompts." — Bryan Bischof (quoted in field guide)

> "Seeing how the LLM breaks down its reasoning made me realize I wasn't being consistent about how I judged certain edge cases." — Phillip Carter (quoted)

### Informs Cog

- **Build an eval harness alongside the agent.** Even 20 hand-curated tasks with binary pass/fail beats no eval.
- **Log every trace.** Make it trivial to inspect what the agent did on a task that failed.
- **Failure taxonomy lives in the repo.** Maintain a `docs/failures.md` clustered by type.

---

## 18. Geoffrey Litt — Coding Like a Surgeon

- **Site:** https://www.geoffreylitt.com/
- **"Lessons from Geoffrey Litt":** https://www.antoinebuteau.com/lessons-from-geoffrey-litt/
- **Dialectic interview:** https://jacksondahl.com/dialectic/geoffrey-litt
- **Year:** 2025

### Key Insights

1. **"Code like a surgeon":** Stay in the loop on the core interface and core logic. Delegate prep, scaffolding, and grunt work to agents. Don't fully YOLO.
2. **Malleable software:** computing environments where end users adapt their tools. AI agents are an enabler — but the surface they manipulate matters.
3. **Custom Agents at Notion** (2026): multiplayer agents whose prompt *is a Notion page*. Co-editing agent instructions is itself a collaboration surface.
4. **Don't outsource intent.** The model produces options; you choose.

### Informs Cog

- **Default to "human in the loop on critical choices."** Auto-approve reads and safe shell, but ask on file edits outside scope or risky shell.
- **Make the agent's plan visible.** The user should always be able to read and edit the running plan.
- **Prompt as data, not code.** Project-level prompts (AGENTS.md style) are user-editable, not buried in source.

---

## 19. Eugene Yan — Patterns for Building LLM Systems

- **Main piece:** https://eugeneyan.com/writing/llm-patterns/
- **Site:** https://eugeneyan.com/
- **Year:** 2023 (still cited in 2026)

### Key Insights

The seven patterns Yan identified remain the right vocabulary:

1. **Evals** — track performance objectively.
2. **RAG** — add external knowledge without retraining.
3. **Fine-tuning** — improve specific tasks.
4. **Caching** — reduce latency + cost (now: prompt caching, KV caching).
5. **Guardrails** — ensure output quality (input/output validation).
6. **Defensive UX** — anticipate and manage errors (loading states, edit-before-send, retry affordances).
7. **Collect user feedback** — thumbs up/down, edits, accept/reject.

### Informs Cog

- **Evals + caching + defensive UX are table stakes.** Build for them from v1.
- **Guardrails as a layer.** Validate tool args before execution; validate model output before applying file edits.
- **Capture feedback at every accept/reject.** Free training data.

---

## 20. Model Landscape — Frontier & Open-Weights

### Anthropic (May 2026)

| Model | SWE-bench Verified | Pricing (in/out, per 1M) | Use case |
| --- | --- | --- | --- |
| **Opus 4.7** | ~80%+ on hardest agentic coding | $5 / $25 | Multi-file refactors, architecture, unfamiliar codebases, deep planning |
| **Sonnet 4.6** | 79.6% | $3 / $15 | **Default.** Feature implementation, bug fixes, code review. 30% fewer tokens than Opus in practice. |
| **Haiku 4.5** | Competitive on smaller tasks | <$1 / <$5 | Code completion, lint review, doc gen, test scaffolding, apply-model role |

Sources: [Anthropic model overview](https://platform.claude.com/docs/en/about-claude/models/overview), [tech-insider 2026 review](https://tech-insider.org/claude-opus-vs-sonnet-vs-haiku-2026/), [knightli model lineup](https://www.knightli.com/en/2026/05/08/anthropic-claude-model-lineup/).

### OpenAI

| Model | SWE-bench Verified | Notes |
| --- | --- | --- |
| **GPT-5** | 74.9% | Aider Polyglot: 88%. |
| **GPT-5.5** | SWE-bench Pro 58.6%, Terminal-Bench 2.0 82.7% | Strongest agentic coding from OpenAI; Responses API native. |

Source: [Introducing GPT-5.5](https://openai.com/index/introducing-gpt-5-5/), [Vellum benchmarks](https://www.vellum.ai/blog/gpt-5-benchmarks).

### Google

| Model | SWE-bench Verified | Notes |
| --- | --- | --- |
| **Gemini 2.5 Pro** | 63.8% | 1M token context (2M planned). Leads LiveCodeBench, WebDev Arena. Powers Cursor agent + Replit. |

Source: [Gemini 2.5 Pro launch](https://blog.google/innovation-and-ai/models-and-research/google-deepmind/gemini-model-thinking-updates-march-2025/).

### Open-Weights

| Model | SWE-bench Verified | Notes |
| --- | --- | --- |
| **GLM-4.7** | 74.2% | Top open-weight. |
| **Qwen3-Coder-Next** | 70.6% | Apache 2.0. 80B/3B MoE. 256K context. Trained on ~800K verifiable coding tasks with RL. Best for local deployment. |
| **DeepSeek-V3.2** | 70.2% | Cost-efficient API. Strong on agent benchmarks. |

Source: [SoftwareSeni comparison](https://www.softwareseni.com/qwen3-coder-next-deepseek-v3-2-and-glm-4-7-which-open-weight-model-wins-for-coding-agents/).

### Routing Strategy for Cog

```
default:
  planner:    Sonnet 4.6        # ~95% of tasks
  generator:  Sonnet 4.6
  apply:      Haiku 4.5         # cheap byte-level edits
  embed:      voyage-3 / OpenAI text-embedding-3-large

escalate to Opus 4.7 when:
  - multi-file refactor (> 5 files)
  - unfamiliar codebase first session
  - planner explicitly requests via "/think hard"

fallback to GPT-5.5 / Gemini 2.5 Pro when:
  - Anthropic API down
  - user explicitly chooses

local-only mode:
  - Qwen3-Coder-Next via Ollama, 256K context
  - Pyodide sandbox
```

---

## Patterns Synthesis

This section distills what every source above converges on. If you implement nothing else from this doc, implement this.

### The Canonical Agent Loop

Every production coding agent boils down to this:

```python
# Pseudocode — match smolagents/Strands/Claude Code/Codex
state = State(
    system_prompt=SYSTEM_PROMPT,           # cached prefix
    tools=TOOL_SPECS,                      # cached prefix
    env=detect_env(),                      # CWD, OS, shell, git
    repo_map=build_repo_map(token_budget=1000),  # cached prefix
    history=[]                             # uncached suffix
)

state.history.append(UserMessage(task))

while not state.is_done():
    if context_pressure(state) > THRESHOLD:
        state = compact(state)             # summarize + reset

    response = model.complete(state)       # streams; supports tool calls
    state.history.append(AssistantMessage(response))

    for tool_call in response.tool_calls:
        result = execute_in_sandbox(tool_call)
        state.history.append(ToolResult(tool_call.id, result))

    if response.is_final():
        break
```

Key invariants every implementation honors:

1. **Prefix is stable.** System prompt → tools → env → repo map are all cacheable.
2. **State = event stream.** Append-only history of Actions and Observations (OpenHands), or Messages with tool calls (Anthropic/OpenAI).
3. **One model call per turn, many tool calls per turn.** A "turn" is user → agent done. Within a turn, hundreds of tool calls can happen.
4. **Compaction is part of the loop**, not an afterthought.
5. **The loop is small.** smolagents' core is <1,000 lines. Cog's should be too.

### The Canonical Tool Catalogue

Every coding agent ships some version of these 8–12 tools:

| Tool | Purpose | Critical details |
| --- | --- | --- |
| `read_file(path, offset?, limit?)` | Read a file with line numbers | Line numbers in output; range params; default cap (e.g., 2000 lines) |
| `write_file(path, content)` | Create a new file | Reject if file exists (force create-only) |
| `edit_file(path, old, new)` or SEARCH/REPLACE block | Modify a file in place | Exact string match; lint after; reject on lint fail (SWE-agent insight) |
| `list_dir(path, recursive?)` | Directory listing | Respect `.gitignore`; cap depth |
| `glob(pattern)` | Find files by glob | Use `ripgrep --files -g` or equivalent |
| `grep(pattern, path?, type?)` | Search file contents | Ripgrep under the hood; line-numbered output; cap results |
| `run_shell(cmd, cwd?, timeout?)` | Execute a shell command | Sandboxed; timeout default 2 min; capture stdout+stderr+exit |
| `run_tests(target?)` | Run the project's test suite | Wraps `run_shell` with project-aware command (from AGENTS.md) |
| `web_fetch(url, prompt)` | Fetch + summarize a URL | Network-isolated; allowlist domains |
| `web_search(query)` | Web search | Optional but very common |
| `todo_write(items)` / `todo_read()` | Track progress in long sessions | Anthropic's pattern: structured note-taking |
| `sub_agent(task, scope)` | Bounded read-only subagent | Optional; only for well-defined questions (Cognition's rule) |

Notes that recur across sources:

- **`read_file` must return line numbers.** Every agent uses them for subsequent edits.
- **`edit_file` should lint after the edit** and reject on failure (SWE-agent).
- **`grep` should be ripgrep**, not regex-on-Python (10–100× speed).
- **`run_shell` is the escape hatch.** Don't try to wrap every CLI tool.
- **Namespacing** (`fs_read`, `fs_write`, `git_status`, `web_fetch`) helps when the catalogue grows.

### Model Selection Landscape (May 2026)

**Rule of thumb:** Sonnet 4.6 is the default; Haiku for apply/lint/cheap; Opus for hardest reasoning; open-weights for local/privacy.

| Task | Model | Why |
| --- | --- | --- |
| Inner planner/generator | **Claude Sonnet 4.6** | Best price/quality. 79.6% SWE-bench, $3/$15. |
| Apply model (semantic diff → bytes) | **Claude Haiku 4.5** | Cheap, fast, deterministic-enough. |
| Hardest reasoning, multi-file refactor | **Claude Opus 4.7** | When Sonnet keeps failing or scope is huge. |
| Terminal/agentic workflows | **GPT-5.5** | 82.7% on Terminal-Bench 2.0. |
| Huge context (entire repo in window) | **Gemini 2.5 Pro** | 1M tokens, 2M coming. |
| Local / privacy / cost | **Qwen3-Coder-Next** | Apache 2.0, 256K context, runs on consumer hardware. |
| Cheapest hosted | **DeepSeek-V3.2** | Strong on agents, cheap API. |

### Context Engineering Patterns

Five distinct buckets of context, in cache-order:

1. **System prompt** (cacheable, ~500–2000 tokens)
   - Role / persona
   - Style preferences ("never refer to tools by name")
   - Edit format declaration (SEARCH/REPLACE)
   - Lint-loop limit ("don't loop more than 3 times")
2. **Tool specs** (cacheable, ~2000–5000 tokens for 10 tools)
   - Name + 1–3 sentence description + examples
   - Parameter schema with descriptions
   - Edge cases and error formats
3. **Environment info** (cacheable per-session, ~200 tokens)
   - CWD, OS, shell, current branch, git status
4. **Repo map** (cacheable per-session, ~1000 tokens default)
   - Tree-sitter signatures, PageRank-ranked
5. **AGENTS.md / CLAUDE.md** (cacheable per-session, ~500–2000 tokens)
   - Project conventions, test commands, no-go zones
6. **Conversation history + tool results** (uncacheable suffix)
   - Append-only
   - Trigger compaction at 70–80% of context window

### Compaction Strategies

In rough order of complexity:

1. **Drop old tool results.** Cheapest; keep messages, replace tool result bodies with `[…truncated, see history]`.
2. **Summarize tool results in place.** Replace verbose outputs with a one-line summary after they're consumed.
3. **Summarize the whole conversation.** A specialized "compaction LLM" condenses prior turns into key decisions + state. Maximize recall first, then iterate for precision (Anthropic).
4. **Hard reset with handoff artifact.** Generate a "state file" (current plan, open questions, file list); reinitialize a fresh agent from it. Anthropic's harness post.
5. **External memory.** `NOTES.md` or a SQLite log the agent writes to and reads from. Survives across sessions.

### Sandboxing & Permissions

The trust hierarchy every agent settles on:

| Action | Default policy |
| --- | --- |
| Read inside CWD | auto-allow |
| Read outside CWD | ask |
| Write inside CWD | auto-allow (with sandbox) or ask (without) |
| Write outside CWD | hard-block |
| Shell command (safelist: `ls`, `cat`, `git status`) | auto-allow |
| Shell command (anything else) | ask once, remember per-pattern |
| Network — allowlist domain | auto-allow |
| Network — other | hard-block |

OS primitives to know:

- **Linux:** bubblewrap, namespaces, seccomp.
- **macOS:** sandbox-exec (seatbelt).
- **Cross-platform:** Docker, Apple container, Pyodide+Deno (WASM).
- **Cloud:** E2B, Modal, GitHub Codespaces.

### Streaming, Caching, and Observability

- **Stream tokens for UX.** Show tool calls as they happen, not after.
- **Mark cache breakpoints explicitly** (`cache_control: ephemeral`). Cache the prefix; never the tail.
- **Don't mutate earlier turns.** Any change invalidates everything after it.
- **OTEL spans for every model call + tool call.** Adds observability for ~no effort. (Strands)
- **Log every turn to disk.** Replay debugging is invaluable.

### What to Build First (Minimal Coding Agent in ~1000 LoC)

If you take only one thing from this doc, take this list:

1. **An event-stream state** (Action + Observation log).
2. **A while loop** that calls the model, dispatches tool calls, and appends results.
3. **Eight tools:** `read_file`, `write_file`, `edit_file` (SEARCH/REPLACE), `list_dir`, `grep` (ripgrep), `run_shell`, `web_fetch`, `todo_write`.
4. **A system prompt** with style rules, edit format, lint-loop limit, and tool-name discretion.
5. **A repo map** from tree-sitter signatures, capped at 1k tokens.
6. **Prompt caching** with `cache_control` on the prefix.
7. **One sandbox** (bubblewrap on Linux, sandbox-exec on macOS, or just Docker).
8. **A 20-task eval harness** with binary pass/fail.
9. **Compaction** when context fills past 70%.
10. **Streaming output** so the user sees what's happening.

Everything else — multi-agent, RAG, custom modes, browser tools, MCP — is an optimization. Earn it with eval data.

---

## Reading Order Recommendations

If you have **1 hour**: Anthropic [Building Effective Agents](https://www.anthropic.com/research/building-effective-agents) + Cognition [Don't Build Multi-Agents](https://cognition.ai/blog/dont-build-multi-agents) + Simon Willison [Designing Agentic Loops](https://simonw.substack.com/p/designing-agentic-loops).

If you have **a weekend**: Add Anthropic [Effective Context Engineering](https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents), [Writing Effective Tools](https://www.anthropic.com/engineering/writing-tools-for-agents), [Sandboxing](https://www.anthropic.com/engineering/claude-code-sandboxing), the [SWE-agent paper](https://arxiv.org/abs/2405.15793), and the [Cursor architecture writeup](https://blog.sshh.io/p/how-cursor-ai-ide-works).

If you have **a week**: Add the [OpenHands paper](https://arxiv.org/abs/2407.16741), [smolagents launch post](https://huggingface.co/blog/smolagents), [Aider repo map](https://aider.chat/docs/repomap.html), [Anthropic harness design](https://www.anthropic.com/engineering/harness-design-long-running-apps), and Hamel Husain's [Field Guide](https://hamel.dev/blog/posts/field-guide/).

If you want to **understand the model landscape**: skim [knightli model lineup](https://www.knightli.com/en/2026/05/08/anthropic-claude-model-lineup/), [Vellum's GPT-5 benchmarks](https://www.vellum.ai/blog/gpt-5-benchmarks), and [SoftwareSeni's open-weight comparison](https://www.softwareseni.com/qwen3-coder-next-deepseek-v3-2-and-glm-4-7-which-open-weight-model-wins-for-coding-agents/).
