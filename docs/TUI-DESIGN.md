# Cog — TUI Design (M1)

The visual spec for Cog's terminal UI. No code in this doc — only the
*look*, the screen-state catalogue, the keyboard map, and the layout
rules. M3 (implementation) renders against this design.

This doc is opinionated on purpose. React against any of it — that's
the point. Mark sections "👍" or "🤔" and we'll iterate.

---

## 1. Goals & non-goals

### Goals

- **Feel like Claude Code.** Minimal chrome. Monospace. Subtle color.
  Calm. Reads top-to-bottom like a chat transcript.
- **Differential rendering** (per `docs/RESEARCH.md §2`). The TUI is a
  function of state; only changed lines repaint.
- **Streaming is first-class.** Text appears as it's generated, not in
  finished chunks.
- **Slash commands are first-class.** Type `/`, see a palette.
- **Works at narrow terminals (≥80 cols).** Beautiful at wide ones.
- **Zero external runtime deps.** ANSI by hand, raw-mode stdin, that's
  it.

### Non-goals (for v1)

- Mouse support.
- Side-by-side panels / multi-column layout.
- Images / inline media.
- Full markdown rendering (treat code blocks specially; ignore the rest).
- Vim / Emacs keybindings (a `$EDITOR` escape hatch only).

---

## 2. Visual language

### 2.1 Color palette

Six logical roles. The terminal's theme decides the actual hex.

| Role         | ANSI       | Used for                                              |
| ------------ | ---------- | ----------------------------------------------------- |
| **default**  | terminal fg | Body text, assistant responses                       |
| **dim**      | `\x1b[2m`  | System messages, hints, timestamps, divider lines    |
| **accent**   | `\x1b[36m` (cyan) | User messages, tool names, prompt indicator   |
| **success**  | `\x1b[32m` (green) | Tool results that succeeded, confirmations   |
| **danger**   | `\x1b[31m` (red) | Errors, denied permissions, doom-loop alert   |
| **warning**  | `\x1b[33m` (yellow) | In-progress spinners, "thinking", warnings |

**Bold** (`\x1b[1m`) for: speaker labels ("You", "Cog"), section
dividers, the active item in any list.

**Italic** (`\x1b[3m`) for: tool input previews. (Not all terminals
support italic — degrade to dim.)

No background colors. No 256-color or true-color. Stick to the 8 base
ANSI colors so it looks right on any terminal theme.

### 2.2 Box drawing

Use Unicode box-drawing only for one thing: the **input box border**.
Everything else is plain text + indentation + dividers.

```
┌─────────────────────────────────────────────────────────────────┐
│ > _                                                              │
└─────────────────────────────────────────────────────────────────┘
```

Use `─` (U+2500) and `│` (U+2502) only. No corners that need
specific rounded vs sharp variants — keep it simple.

### 2.3 Speaker labels and indentation

Every turn in the transcript starts with a speaker label and is indented
two spaces beneath it. No avatars, no emoji, no nested boxes.

```
You
  How does the agent loop work in pi?

Cog
  The agent loop in pi has two layers...
```

Wraps respect the indent.

### 2.4 Dividers

A single dim horizontal rule between turns. The rule spans the full
terminal width.

```
You
  hi

────────────────────────────────────────────────────────────────────

Cog
  Hello! How can I help?
```

### 2.5 Typography rules

- **Never bold body text.** Only labels and headings.
- **Code spans** (backticks) render as dim. No syntax highlighting in
  inline code.
- **Code blocks** (triple-backtick) get a dim left rule:

  ```
  │ const x = 1
  │ const y = 2
  ```

  No fancy syntax highlighting in v1. (Maybe in M4 polish.)

---

## 3. Layout

The screen is always three regions, top to bottom:

```
┌──────────────────────────────────────────────────────────────────┐
│                                                                  │
│                                                                  │
│                        TRANSCRIPT                                │
│                    (scrolls; expands)                            │
│                                                                  │
│                                                                  │
├──────────────────────────────────────────────────────────────────┤
│ > input box                                                      │
├──────────────────────────────────────────────────────────────────┤
│ haiku-4-5   ·   1.2k tokens   ·   $0.001   ·   ~/projects/cog   │
└──────────────────────────────────────────────────────────────────┘
```

- **Transcript** — top, grows to fill. Newest content at the bottom.
- **Input box** — single line by default, grows up when multi-line.
- **Status bar** — bottom, one line, always visible.

The transcript scrolls so the **last assistant output is always
visible** unless the user has scrolled up explicitly. (Like a terminal.)

---

## 4. Screen state catalogue

Every screen Cog can show. Each entry: trigger, mockup, notes.

---

### 4.1 First-run welcome

**Trigger:** `cog` with no args, no `~/.cog/` dir present.

```
                        ┌─────────────┐
                        │     cog     │
                        └─────────────┘

  A minimal coding agent.
  Type a message to begin. Press / for commands. Press ? for help.

┌──────────────────────────────────────────────────────────────────┐
│ > _                                                              │
└──────────────────────────────────────────────────────────────────┘
 haiku-4-5   ·   0 tokens   ·   $0.000   ·   ~/projects/cog
```

Centered banner. The body two-line intro is dim text. Cursor blinks in
the input box.

---

### 4.2 Active conversation, idle

**Trigger:** at least one turn has happened, no model call in flight.

```
You
  How does the agent loop work?

────────────────────────────────────────────────────────────────────

Cog
  The loop has two layers: a low-level streaming dispatcher
  and a stateful Agent wrapper. The dispatcher handles tool
  calls; the Agent owns the transcript and lifecycle hooks.

────────────────────────────────────────────────────────────────────

┌──────────────────────────────────────────────────────────────────┐
│ > _                                                              │
└──────────────────────────────────────────────────────────────────┘
 haiku-4-5   ·   1.2k tokens   ·   $0.001   ·   ~/projects/cog
```

The trailing divider after "Cog" indicates "ready for next message."
Cursor focused in the input box.

---

### 4.3 Streaming text response

**Trigger:** model is actively producing tokens.

```
You
  Explain just-bash in one paragraph

────────────────────────────────────────────────────────────────────

Cog
  just-bash is a pure-TypeScript bash interpreter with an
  in-memory virtual filesyste▌

┌──────────────────────────────────────────────────────────────────┐
│ esc to interrupt                                                 │
└──────────────────────────────────────────────────────────────────┘
 haiku-4-5   ·   thinking…   ·   $0.000   ·   ~/projects/cog
```

- A block cursor `▌` indicates active streaming, drawn at the very end
  of the response.
- The **input box content changes to a dim hint** ("esc to interrupt").
- The status bar replaces the token count with `thinking…` in **warning**
  color until the response finishes.
- Press `Esc` once to interrupt (graceful: agent gets to finalize).
  Press `Esc` twice (or `Ctrl+C`) to hard-abort.

---

### 4.4 Tool call in progress

**Trigger:** model emitted a `tool_use` block; tool is executing.

```
Cog
  I'll check the project structure first.

  ↳ list_dir(path="./packages")
    │ running…

────────────────────────────────────────────────────────────────────

┌──────────────────────────────────────────────────────────────────┐
│ esc to interrupt                                                 │
└──────────────────────────────────────────────────────────────────┘
 haiku-4-5   ·   list_dir…   ·   $0.001   ·   ~/projects/cog
```

- Each tool call shows on its own block:
  - `↳` prefix in **accent** color
  - tool name in **accent**, args in `italic`/`dim`
  - status line beneath, indented, with a dim left rule `│`
- Status bar shows the active tool name.
- A spinner is **not** used. Static `running…` text avoids redraw
  churn and feels calmer.

---

### 4.5 Tool result (collapsed)

**Trigger:** tool finished. Default view is collapsed (first 3 lines +
a "more" hint).

```
Cog
  I'll check the project structure first.

  ↳ list_dir(path="./packages")
    │ agent/
    │ cog/
    │ providers/
    │ … 2 more lines · press ⏎ to expand

  Looks like we have 5 packages. Let me read agent's README.
```

- The `│` left rule continues from the in-progress state.
- "more lines" hint is **dim**.
- Press `Enter` while hovering / focused (TBD: keyboard nav) to expand.
- Errors render with a **danger**-colored `│` rule and an `✗` prefix.

---

### 4.6 Tool result (expanded)

**Trigger:** user pressed `Enter` to expand.

```
  ↳ list_dir(path="./packages")
    │ agent/
    │ cog/
    │ providers/
    │ tools/
    │ tui/
    │ ⏎ to collapse
```

Same `│` rule. Full content. Footer note tells you how to collapse
again.

---

### 4.7 Permission prompt

**Trigger:** model wants to run a tool that requires approval (writes,
shell commands, anything not in the auto-allow list).

```
Cog
  I need to run the tests to verify.

  ↳ bash("pnpm test")
    │
    │  Allow this command?
    │
    │    [y]  yes, this once
    │    [a]  yes, always allow `pnpm test *`
    │    [n]  no
    │    [N]  no, and stop the current task
    │
    │  > _
```

- The prompt is **inline in the transcript**, not a modal overlay.
  Makes it feel like part of the conversation, not a popup.
- The input box at the bottom of the screen is **disabled and dimmed**
  while a permission is pending.
- Single-key shortcuts. `y`/`a`/`n`/`N`. No Enter required.
- `a` adds the pattern to session-scoped allow rules and the same
  pattern won't prompt again this session.

---

### 4.8 Slash command palette

**Trigger:** user types `/` as the first character of input.

```
┌──────────────────────────────────────────────────────────────────┐
│ > /m_                                                            │
└──────────────────────────────────────────────────────────────────┘
┌──────────────────────────────────────────────────────────────────┐
│ ▸ /model    switch the active model                              │
│   /memory   manage saved context                                 │
│                                                                  │
│   ↑↓ to navigate · ⏎ to select · esc to cancel                   │
└──────────────────────────────────────────────────────────────────┘
 haiku-4-5   ·   1.2k tokens   ·   $0.001   ·   ~/projects/cog
```

- The palette opens **above** the input box, pushing the transcript up.
- Live filter as you type.
- Active item in **accent** with `▸` prefix.
- Footer hint in **dim**.

### 4.8.1 Built-in slash commands (v1)

| Command       | Purpose                                          |
| ------------- | ------------------------------------------------ |
| `/help`       | Show keyboard shortcuts and command list         |
| `/clear`      | Clear the transcript (keeps session state)       |
| `/exit`       | Quit cog                                         |
| `/model`      | Switch active model (M5+ when we have >1)        |
| `/new`        | Start a new session                              |
| `/resume`     | Resume a recent session                          |
| `/cost`       | Show token / cost breakdown                      |

User-defined (later):

| Command                      | Loaded from                                  |
| ---------------------------- | -------------------------------------------- |
| `/<custom>` (project-local)  | `./.cog/commands/<name>.md`                  |
| `/<custom>` (global)         | `~/.cog/commands/<name>.md`                  |

Local overrides global.

---

### 4.9 Multi-line input

**Trigger:** user types `Shift+Enter` (or just keeps typing past the
width).

```
┌──────────────────────────────────────────────────────────────────┐
│ > Help me refactor the agent loop. The current implementation    │
│   has the streaming and dispatch logic intertwined and I want    │
│   to split them so the dispatcher can be tested independently.   │
│   _                                                              │
└──────────────────────────────────────────────────────────────────┘
```

- The input box grows up; the transcript shifts up to make room.
- Auto-wrap at the box width. Wrapped lines align to the `>` indent.
- `Enter` submits. `Shift+Enter` inserts a newline.
- `Ctrl+E` opens `$EDITOR` (M4 polish) for really long writes.

---

### 4.10 Long output / scrollback

**Trigger:** transcript exceeds visible height.

The transcript scrolls naturally — only the visible window renders.
The user can scroll back with:

- `PageUp` / `PageDown` — page-wise.
- `Ctrl+U` / `Ctrl+D` — half-page (vim-ish).
- Any keystroke that produces a character returns to the bottom (i.e.
  typing in the input box scrolls back to current).

When the user is **not** at the bottom, a dim hint appears at the
right edge of the input box:

```
┌──────────────────────────────────────────────────────────────────┐
│ > _                                              · scrolled up · │
└──────────────────────────────────────────────────────────────────┘
```

---

### 4.11 Error state — API error

**Trigger:** provider call failed (rate limit, 5xx, network).

```
Cog
  ✗ anthropic api error: 429 rate_limited
    retry in 12s, or press r to retry now, q to abort
```

- `✗` and the error line are **danger**.
- Inline in the transcript, not a modal.
- Single-key shortcuts (`r` / `q`) while the error is the most recent
  message.

---

### 4.12 Error state — tool failure

**Trigger:** a tool's `execute` threw or returned `isError: true`.

```
  ↳ read_file(path="./nope.ts")
    │ ✗ ENOENT: no such file or directory
```

- Same left-rule rendering as a regular tool result, but the rule
  itself is **danger**-colored and an `✗` prefix on the message.
- The model sees this as a tool result and decides what to do (usually
  apologize, retry, or course-correct).

---

### 4.13 Doom-loop detected

**Trigger:** model called the same tool with identical input 3 times in
a row (per opencode's `processor.ts:370-394`).

```
  ↳ read_file(path="./agent.ts")
    │ (3rd time with the same input)
    │
    │  ⚠ doom loop detected
    │
    │    [c]  continue anyway
    │    [s]  stop and ask me
```

- Warning-colored `⚠`.
- Pause the loop until user decides.
- This is a permission prompt variant; same UX rules apply.

---

### 4.14 Compaction in progress

**Trigger:** context window crossed 80% threshold; cog is summarizing
older turns.

```
────────────────────────────────────────────────────────────────────

  ⋯ compacting older turns…   97k / 200k tokens

────────────────────────────────────────────────────────────────────
```

- Dim, between divider lines.
- After compaction completes, replace with a one-line summary entry:

  ```
  ────────────────────────────────────────────────────────────────────

    ⋯ compacted 18 turns to summary   42k / 200k tokens

  ────────────────────────────────────────────────────────────────────
  ```

---

### 4.15 Help screen (`/help`)

**Trigger:** `/help` or `?`.

```
Cog · keyboard shortcuts

  ⏎              send message
  shift+⏎        new line
  esc            interrupt current generation
  esc esc        hard abort
  /              open slash command palette
  ctrl+e         open $EDITOR for current input
  ctrl+l         clear screen
  pgup / pgdn    scroll transcript
  ctrl+c         quit

Slash commands

  /help          this screen
  /clear         clear transcript
  /exit          quit
  /new           start new session
  /resume        list recent sessions
  /cost          show token usage

Press any key to return.
```

Plain text, dim where listed above. Reads like a man page.

---

## 5. Status bar spec

One line, always visible at the bottom.

```
 haiku-4-5   ·   1.2k tokens   ·   $0.001   ·   ~/projects/cog
```

Left to right:

1. **Model id.** Always shown.
2. **Token count or activity.** When idle: `<n>k tokens`. When the
   model is calling: `thinking…`. When a tool is running:
   `<tool_name>…`. **Warning**-colored during activity, **dim**
   otherwise.
3. **Session cost.** USD, 3 decimals. Updates after each model call.
4. **Working directory.** Tilde-expanded. Right-aligned (with truncate
   on narrow terminals — `~/.../foo`).

Separator is `   ·   ` (three spaces, middle dot, three spaces) in dim.

If the terminal is too narrow (< 80 cols), drop fields from the right.
Working directory is the first to go.

---

## 6. Keyboard map (canonical)

| Key             | Action                                              |
| --------------- | --------------------------------------------------- |
| `Enter`         | Send message                                        |
| `Shift+Enter`   | New line in input                                   |
| `Esc`           | Interrupt current generation (graceful)             |
| `Esc Esc` / `Ctrl+C` | Hard abort                                     |
| `/`             | Open slash command palette                          |
| `Ctrl+E`        | Open `$EDITOR` for current input (M4)               |
| `Ctrl+L`        | Clear screen (re-render transcript)                 |
| `PageUp`/`PgDn` | Scroll transcript                                   |
| `Ctrl+U`/`Ctrl+D` | Half-page scroll                                  |
| `Tab`           | Slash-command completion (when palette open)        |
| `↑` / `↓`       | Navigate slash command palette / previous prompts   |
| `y/a/n/N`       | Single-key answers to permission prompts            |
| `r/q`           | Single-key answers to error prompts                 |

Keys are global except inside the input box (typing chars goes to
input). Single-key prompts only consume keystrokes when a prompt is
active.

---

## 7. Animation / redraw policy

- **Render at most every 16ms** (~60fps cap). Coalesce updates between
  ticks. This is what makes streaming feel smooth but not jittery.
- **No spinners.** Static `…`-suffixed labels. Spinners burn CPU on
  redraws and look anxious.
- **Cursor blink is the terminal's job.** Don't simulate it.
- **No fade-in / slide animations.** They look bad in terminals.

---

## 8. Width handling

| Width        | Behavior                                                       |
| ------------ | -------------------------------------------------------------- |
| ≥ 100 cols   | Full layout                                                    |
| 80–99 cols   | Drop working directory from status bar                         |
| 60–79 cols   | Drop cost too. Shorten model name (`haiku-4-5` → `haiku`)      |
| < 60 cols    | Refuse to start: print "cog needs a terminal at least 60 cols wide" and exit 1 |

---

## 9. Open questions for you to answer

These are choices I made for you in this draft. Push back on any:

1. **Inline permission prompts vs. modal overlay.** I picked inline. A
   modal pops over the screen and feels more "this needs your
   attention." Both are valid. Strong preference?
2. **Speaker labels: "You" / "Cog" vs "user" / "assistant" vs none?**
   I picked "You" / "Cog" for warmth.
3. **Should the input box always have its border, or only when
   focused?** I picked always-bordered.
4. **Status bar position: bottom (current) or top?** I picked bottom
   so the cursor in the input box is closer to the most recent context.
5. **Block cursor `▌` or underscore `_`?** I picked block. The TUI will
   render this at the *current text insertion point*, separate from
   the hardware cursor.
6. **Should slash command palette show command descriptions inline (as
   above) or just names?** I picked inline. Discoverability matters.
7. **Centered welcome banner or left-aligned?** I picked centered.
8. **Box-drawing for input only, or also for permission prompts?** I
   picked input-only.
9. **Dim divider between turns: keep or drop?** I picked keep — gives
   visual rhythm.
10. **`Ctrl+L` to clear screen: clear transcript visually but keep
    session, or full reset?** I picked visual-only.

---

## 10. What this design *forces* into M2 and M3

The shape of `StreamEvent` (M2) needs at minimum:

```
text_delta        { delta: string }                      # 4.3
tool_use_start    { id, name, input }                    # 4.4
tool_use_running  { id, partialOutput?: string }         # 4.4 status
tool_use_end      { id, result: TextContent[], isError } # 4.5
permission_ask    { id, prompt: string, patterns: [] }   # 4.7
status_change     { active: "thinking" | "<tool>" | "idle" } # status bar
error             { message, recoverable: boolean }      # 4.11
stop              { reason }
compact_start     { tokensBefore, tokensTarget }         # 4.14
compact_end       { tokensAfter }
```

This is the contract M2's mock provider emits and M3's renderer
consumes. Pin it down here, never break it.

The TUI module (M3) is roughly:

```
packages/tui/src/
  index.ts            # public exports
  renderer.ts         # differential renderer (the 300 LOC heart)
  terminal.ts         # raw stdin, ANSI helpers, resize
  components/
    transcript.ts     # the scrolling chat area
    input-box.ts      # the bordered input
    status-bar.ts     # the bottom line
    slash-palette.ts  # the floating command picker
    permission.ts     # inline permission prompt
  theme.ts            # the 6-role color table
  keys.ts             # key parser
```

Each `.ts` file is one focused thing. Total target: **<1500 LOC** for
the entire `packages/tui/`.

---

## 11. Sign-off

When you're done reading this:

- Mark each "Open question" in §9 with your call.
- Note any screen state you'd like to see that I missed.
- React to color choices in §2.1 — those propagate everywhere.

Once we've iterated, this doc is **locked**, and M3 implementation is
its faithful realization.
