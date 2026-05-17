# Cog — TUI Design (M1)

The visual spec for Cog's terminal UI. No code in this doc — only the
*look*, the screen-state catalogue, the keyboard map, and the layout
rules. M3 (implementation) renders against this design.

**Status: locked.** Signed off after the round 1 review (2026-05). Open
deferrals are listed in §9; they don't block M2 or M3.

---

## 1. Goals & non-goals

### Goals

- **Feel like Claude Code / pi.** Minimal chrome. Monospace. Subtle
  color. Calm. Reads top-to-bottom like a chat transcript.
- **Differential rendering** (per `docs/RESEARCH.md §2`). The TUI is a
  function of state; only changed lines repaint.
- **Streaming is first-class.** Text appears as it's generated, not in
  finished chunks.
- **Slash commands are first-class.** Type `/`, see a palette.
- **Works at narrow terminals (≥80 cols).** Beautiful at wide ones.
- **Themeable.** The color palette is a swappable table; the renderer
  reads role-named colors, never hex literals.
- **Zero external runtime deps.** ANSI by hand, raw-mode stdin, that's
  it.

### Non-goals (for v1)

- Mouse interactions other than scroll.
- Side-by-side panels / multi-column layout.
- Inline images / media.
- Full markdown rendering — code blocks get a left rule, everything
  else is plain text in v1. (Richer markdown is a deferred concern, §9.)
- Vim / Emacs keybindings (a `$EDITOR` escape hatch only).

---

## 2. Visual language

### 2.1 Color palette (themeable)

Six **logical roles**, never hex literals. The renderer asks for
`theme.fg('accent', ...)` and the theme decides which ANSI escape to
emit. Themes are plain JS modules; swapping themes is a one-line change
at startup.

| Role         | Default ANSI  | Used for                                                  |
| ------------ | ------------- | --------------------------------------------------------- |
| **default**  | terminal fg   | Body text, assistant responses                            |
| **dim**      | `\x1b[2m`     | Hints, timestamps, secondary status, slash-cmd hint text  |
| **accent**   | `\x1b[36m`    | Tool names, prompt indicator, slash-palette active item   |
| **success**  | `\x1b[32m`    | Tool results that succeeded, confirmations                |
| **danger**   | `\x1b[31m`    | Errors, denied permissions, doom-loop alert               |
| **warning**  | `\x1b[33m`    | Compaction indicator, warnings                            |

And one **background role**, used only for user messages:

| Role           | Default ANSI    | Used for                       |
| -------------- | --------------- | ------------------------------ |
| **user-bg**    | `\x1b[100m`     | The full width of user message lines (dim-gray bg) |

The renderer's theme API:

```
theme.fg('accent')        → ANSI escape for accent foreground
theme.bg('user-bg')       → ANSI escape for user-msg background
theme.style('bold')       → ANSI escape for bold
theme.reset()             → "\x1b[0m"
```

A second theme module (e.g. `themes/light.ts`) only needs to provide a
different mapping. No renderer code changes.

**Bold** (`\x1b[1m`) for: the active item in any list, headings in
`/help`.

**Italic** (`\x1b[3m`) for: tool input previews. Terminals that don't
support italic degrade to dim — the theme decides.

Stick to the 8 base ANSI colors so it looks right on any terminal
theme. (The `user-bg` role uses ANSI 100, which is "bright black
background" — universally supported.)

### 2.2 Box drawing

Use Unicode box-drawing only for the **input box border**. Everything
else is plain text + indentation.

```
┌─────────────────────────────────────────────────────────────────┐
│ > _                                                              │
└─────────────────────────────────────────────────────────────────┘
```

Use `─` (U+2500), `│` (U+2502), and the four corner glyphs. This
matches pi-tui and Claude Code exactly.

> **Deferred:** if the model returns markdown tables, we'll need a
> table-rendering pass. Open in §9. v1 renders tables as the model's
> raw markdown source — ugly but legible.

### 2.3 Message rendering (no speaker labels)

**User messages get a dim-gray background.** Assistant messages are
rendered as plain default text. There are no `You:` / `Cog:` labels —
the background tint is the only visual demarcation, mirroring Claude
Code and pi.

In ASCII mockups below, user messages are annotated with `←` arrows to
indicate the background tint. In the real renderer, the user message's
lines are emitted as:

```
<bg user-bg> <padded full-width text> <reset>
```

Padding extends the background to the right edge so the tint reads as
a "speech bubble", not a half-line strip.

```
  How does the agent loop work?                                ← user bg

  The loop has two layers: a low-level streaming dispatcher
  and a stateful Agent wrapper. The dispatcher handles tool
  calls; the Agent owns the transcript and lifecycle hooks.
```

Word wrap respects the indent (two spaces of left margin for every
message). User messages wrap inside the background-tinted region.

### 2.4 No dividers between turns

Earlier drafts had `─────` rules between turns. **Removed.** Once user
messages have a background tint and assistant messages are plain text,
the visual rhythm is clear without any explicit separator. The only
border in the UI is the input box.

### 2.5 Typography rules

- **Never bold body text.** Only the active item in lists.
- **Code spans** (backticks) render as dim.
- **Code blocks** (triple-backtick) get a dim left rule and a small
  top/bottom padding:

  ```
  │ const x = 1
  │ const y = 2
  ```

  No syntax highlighting in v1.

> **Deferred:** richer markdown rendering (headings, links, lists,
> blockquotes, tables) to parity with pi / Claude Code. Tracked in §9.
> v1 ships plain text + code blocks + that's it.

---

## 3. Layout

Three regions, top to bottom:

```
┌──────────────────────────────────────────────────────────────────┐
│                                                                  │
│                                                                  │
│                        TRANSCRIPT                                │
│                    (scrolls; expands)                            │
│                                                                  │
│  (optional, only when active)   ⣾ thinking…                      │
├──────────────────────────────────────────────────────────────────┤
│ > input box                                                      │
├──────────────────────────────────────────────────────────────────┤
│  ~/projects/cog                                       haiku-4-5  │
│  1.2k tokens · $0.001                                            │
└──────────────────────────────────────────────────────────────────┘
```

- **Transcript** — top, expands. Newest content at the bottom.
- **Activity line** — appears one line above the input box *only* when
  the model is thinking or a tool is running. Otherwise the row is
  blank (no jitter when activity starts/stops).
- **Input box** — single line by default, grows up when multi-line.
- **Status bar** — **two rows** at the bottom:
  - **Top row:** working directory (left) · model name (right).
  - **Bottom row:** token count · cost (left).

The transcript auto-scrolls so the **latest output is always visible**
unless the user has scrolled up explicitly.

---

## 4. Screen state catalogue

Each entry: trigger, mockup, notes. `← user bg` annotates a user
message that renders with the dim-gray background tint.

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
 ~/projects/cog                                          haiku-4-5
 0 tokens · $0.000
```

Centered banner. Dim intro text. Cursor blinks in the input box.

---

### 4.2 Active conversation, idle

**Trigger:** at least one turn has happened, no model call in flight.

```
  How does the agent loop work?                                ← user bg

  The loop has two layers: a low-level streaming dispatcher
  and a stateful Agent wrapper. The dispatcher handles tool
  calls; the Agent owns the transcript and lifecycle hooks.

┌──────────────────────────────────────────────────────────────────┐
│ > _                                                              │
└──────────────────────────────────────────────────────────────────┘
 ~/projects/cog                                          haiku-4-5
 1.2k tokens · $0.001
```

No divider between user message and assistant response — the
background tint is the boundary. No "thinking" line above the input
box since the model is idle.

---

### 4.3 Streaming text response

**Trigger:** model is actively producing tokens.

```
  Explain just-bash in one paragraph                           ← user bg

  just-bash is a pure-TypeScript bash interpreter with an
  in-memory virtual filesyste

⣾ thinking…
┌──────────────────────────────────────────────────────────────────┐
│ esc to interrupt                                                 │
└──────────────────────────────────────────────────────────────────┘
 ~/projects/cog                                          haiku-4-5
 1.2k tokens · $0.001
```

- **No cursor character** at the end of the streaming text. The fact
  that text is appearing is its own indicator.
- **Activity line above the input box:** a braille spinner
  (`⣾⣽⣻⢿⡿⣟⣯⣷`) cycling at ~80ms, followed by `thinking…` in
  warning color. When tools are running, the label switches to the
  tool name (see §4.4).
- **Input box content** becomes a dim hint: `esc to interrupt`.
- `Esc` once = graceful interrupt (agent gets to finalize).
  `Esc Esc` or `Ctrl+C` = hard abort.
- ASCII fallback: if the terminal doesn't render braille,
  `|/-\` rotation in the same slot. The theme decides.

---

### 4.4 Tool call in progress

**Trigger:** model emitted a `tool_use` block; tool is executing.

```
  Show me the package layout                                   ← user bg

  I'll check the project structure first.

  ↳ list_dir(path="./packages")
    │ running…

⣾ list_dir…
┌──────────────────────────────────────────────────────────────────┐
│ esc to interrupt                                                 │
└──────────────────────────────────────────────────────────────────┘
 ~/projects/cog                                          haiku-4-5
 1.2k tokens · $0.002
```

- Each tool call shows on its own block:
  - `↳` prefix in **accent**.
  - tool name in **accent**, args in `italic`/`dim`.
  - status line beneath with a dim `│` left rule.
- Activity line above input box shows the tool name.
- No spinner in the transcript block itself — only the one above the
  input. Avoids two animated points on screen.

---

### 4.5 Tool result (collapsed)

**Trigger:** tool finished. Default view is collapsed (first 3 lines +
a "more" hint).

```
  ↳ list_dir(path="./packages")
    │ agent/
    │ cog/
    │ providers/
    │ … 2 more lines · press ⏎ to expand

  Looks like we have 5 packages. Let me read agent's README.
```

- The `│` left rule continues from the in-progress state, now in
  **success** color.
- "more lines" hint is **dim**.
- `Enter` on the focused tool result expands it.

---

### 4.6 Tool result (expanded)

**Trigger:** user pressed `Enter` while a collapsed result was focused.

```
  ↳ list_dir(path="./packages")
    │ agent/
    │ cog/
    │ providers/
    │ tools/
    │ tui/
    │ ⏎ to collapse
```

---

### 4.7 Permission prompt

**Trigger:** model wants to run a tool that requires approval.

```
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

- **Inline in the transcript.** Feels like part of the conversation,
  not a popup.
- Input box at the bottom of the screen is **disabled and dimmed** while
  a permission is pending.
- Single-key shortcuts. `y` / `a` / `n` / `N`. No Enter required.
- `a` adds the pattern to session-scoped allow rules; subsequent
  matches don't prompt this session.

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
 ~/projects/cog                                          haiku-4-5
 1.2k tokens · $0.001
```

- Palette opens **above** the input box, pushing the transcript up.
- Live filter as you type.
- Active item in **accent** with `▸` prefix and **bold**.
- Inline descriptions next to each command name.

#### 4.8.1 Built-in slash commands (v1)

| Command       | Purpose                                          |
| ------------- | ------------------------------------------------ |
| `/help`       | Show keyboard shortcuts and command list         |
| `/clear`      | Clear the transcript (keeps session state)       |
| `/exit`       | Quit cog                                         |
| `/model`      | Switch active model (M5+ when we have >1)        |
| `/new`        | Start a new session                              |
| `/resume`     | Resume a recent session                          |
| `/cost`       | Show token / cost breakdown                      |

Provider auth (added in M10 when multi-provider lands):

| Command       | Purpose                                              |
| ------------- | ---------------------------------------------------- |
| `/login`      | OAuth / API-key flow for the active provider         |
| `/logout`     | Clear stored credentials for the active provider     |

User-defined (later):

| Command source                | Loaded from                            |
| ----------------------------- | -------------------------------------- |
| Project-local                 | `./.cog/commands/<name>.md`            |
| Global                        | `~/.cog/commands/<name>.md`            |

Local overrides global.

---

### 4.9 Multi-line input

**Trigger:** user presses `Shift+Enter` or keeps typing past the
width.

```
┌──────────────────────────────────────────────────────────────────┐
│ > Help me refactor the agent loop. The current implementation    │
│   has the streaming and dispatch logic intertwined and I want    │
│   to split them so the dispatcher can be tested independently.   │
│   _                                                              │
└──────────────────────────────────────────────────────────────────┘
```

- Box grows up; the transcript shifts up to make room.
- Auto-wrap at the box width. Wrapped lines align to the `>` indent.
- `Enter` submits. `Shift+Enter` newline.
- `Ctrl+E` opens `$EDITOR` (M4 polish) for really long writes.

---

### 4.10 Scrollback

The transcript scrolls naturally — only the visible window renders.
The user can scroll back with:

- **Mouse wheel** up/down.
- `PageUp` / `PageDown` — page-wise.
- `Ctrl+U` / `Ctrl+D` — half-page (vim-ish).
- Any keystroke that produces a character in the input box returns
  the transcript to the bottom.

When the user is not at the bottom, a dim hint appears at the right
edge of the input box:

```
┌──────────────────────────────────────────────────────────────────┐
│ > _                                              · scrolled up · │
└──────────────────────────────────────────────────────────────────┘
```

---

### 4.11 Error state — API error

**Trigger:** provider call failed (rate limit, 5xx, network).

```
  ✗ anthropic api error: 429 rate_limited
    retry in 12s, or press r to retry now, q to abort
```

- `✗` and the line are **danger**.
- Inline in transcript, not a modal.
- Single-key shortcuts (`r` / `q`) while the error is the most recent
  message.

---

### 4.12 Error state — tool failure

**Trigger:** a tool's `execute` threw or returned `isError: true`.

```
  ↳ read_file(path="./nope.ts")
    │ ✗ ENOENT: no such file or directory
```

- Same left-rule rendering as a regular tool result, but the rule and
  prefix are **danger**-colored.
- The model sees this as a tool result and decides what to do next.

---

### 4.13 Doom-loop detected

**Trigger:** model called the same tool with identical input 3 times
in a row.

```
  ↳ read_file(path="./agent.ts")
    │ (3rd time with the same input)
    │
    │  ⚠ doom loop detected
    │
    │    [c]  continue anyway
    │    [s]  stop and ask me
```

- Warning-colored `⚠`. Pauses the loop until the user decides.
- Permission-prompt variant; same UX rules apply.

---

### 4.14 Compaction in progress

**Trigger:** context window crossed 80% threshold; cog is summarizing
older turns.

```
 ~/projects/cog                              ⋯ compacting    haiku-4-5
 97k / 200k tokens · $0.014
```

- Just a one-word indicator (`⋯ compacting`) inserted into the **top
  row of the status bar** between the working directory and the model
  name, in **warning** color.
- No progress bar, no spinner inside the transcript. Compaction is
  background work; the user shouldn't have to watch it.
- Once finished, the indicator disappears; tokens drop in the next
  status update.

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
  ⇡⇣ mouse       scroll transcript
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

Plain text. Reads like a man page.

---

## 5. Status bar spec

**Two rows**, always visible at the bottom, no border.

```
 ~/projects/cog                                          haiku-4-5
 1.2k tokens · $0.001
```

### Top row

- **Left:** working directory, tilde-expanded.
- **Right:** model id (right-aligned, flush to terminal width).
- (Compaction indicator slots in between when active — see §4.14.)

### Bottom row

- **Left:** `<n>k tokens · $<cost>`. Updates after each model call.
- Separator: ` · ` in dim.

### Width-aware truncation

- Working directory truncates from the **left** at narrow widths
  (`~/.../cog`) so the basename stays visible.
- Model name on the top row is the last thing to truncate
  (`haiku-4-5` → `haiku`).

### Color rules

- Default text color for content.
- **Dim** for separators (`·`) and the `tokens` / `$` labels.
- **Warning** for activity injected into the top row (`⋯ compacting`).

---

## 6. Keyboard map (canonical)

| Key                  | Action                                              |
| -------------------- | --------------------------------------------------- |
| `Enter`              | Send message                                        |
| `Shift+Enter`        | New line in input                                   |
| `Esc`                | Interrupt current generation (graceful)             |
| `Esc Esc` / `Ctrl+C` | Hard abort                                          |
| `/`                  | Open slash command palette                          |
| `Ctrl+E`             | Open `$EDITOR` for current input (M4)               |
| `Ctrl+L`             | Visually clear screen (keep session)                |
| `PageUp` / `PageDown`| Scroll transcript                                   |
| `Ctrl+U` / `Ctrl+D`  | Half-page scroll                                    |
| **Mouse wheel**      | Scroll transcript                                   |
| `Tab`                | Slash-command completion (when palette open)        |
| `↑` / `↓`            | Navigate slash command palette / previous prompts   |
| `y/a/n/N`            | Single-key answers to permission prompts            |
| `r/q`                | Single-key answers to error prompts                 |

Keys are global except inside the input box (typing chars goes to
input). Single-key prompts only consume keystrokes when a prompt is
active.

---

## 7. Animation / redraw policy

- **Render at most every 16ms** (~60fps cap). Coalesce updates between
  ticks.
- **Exactly one animated element on screen at a time:** the activity
  spinner above the input box (when active). Nothing else animates —
  no fades, no slides, no cursor blink (the terminal handles its own).
- **Spinner frame interval:** 80ms. Braille glyphs (`⣾⣽⣻⢿⡿⣟⣯⣷`)
  with `|/-\` fallback if the terminal can't render braille.
- **Begin/end synchronized output** (`\x1b[?2026h` / `?2026l`) wraps
  each frame so terminals that support it commit atomically.

---

## 8. Width handling

| Width        | Behavior                                                       |
| ------------ | -------------------------------------------------------------- |
| ≥ 100 cols   | Full layout                                                    |
| 80–99 cols   | Truncate working directory from the left (`~/.../cog`)         |
| 60–79 cols   | Shorten model name (`haiku-4-5` → `haiku`)                     |
| < 60 cols    | Refuse to start: print "cog needs a terminal at least 60 cols wide" and exit 1 |

---

## 9. Decisions made (formerly: open questions)

All 10 design questions from the earlier draft are resolved:

| #  | Question                                              | Decision                          |
| -- | ----------------------------------------------------- | --------------------------------- |
| 1  | Inline vs modal permission prompts                    | **Inline**                        |
| 2  | Speaker labels (You/Cog vs none)                      | **None** — user has bg tint only  |
| 3  | Input box always bordered vs only-when-focused        | **Always bordered**               |
| 4  | Status bar position                                   | **Bottom**, two rows              |
| 5  | Block cursor vs underscore (in input box)             | **Block** `▌`                     |
| 6  | Slash palette: descriptions inline or names-only      | **Descriptions inline**           |
| 7  | Centered vs left-aligned welcome banner               | **Centered**                      |
| 8  | Box-drawing for input only or also permission prompts | **Input only**                    |
| 9  | Dim divider between turns                             | **No divider** — bg tint is enough |
| 10 | `Ctrl+L` semantics                                    | **Visual-only** (keeps session)   |

### Deferrals (do not block M2 / M3)

- **Markdown tables** rendering — v1 dumps raw markdown.
- **Rich markdown** in general (headings, links, lists, blockquotes)
  to parity with pi / Claude Code. v1 ships plain text + code blocks.
- **Inline code syntax highlighting.** Plain dim spans for v1.
- **Theme palettes** beyond the default. The theming hook exists; only
  one theme is implemented in v1.

---

## 10. What this design forces into M2 and M3

### `StreamEvent` shape (M2 contract)

This is the wire shape between providers and TUI. M2's `MockProvider`
emits these; M3's renderer consumes them.

```
text_delta        { delta: string }                      # §4.3
tool_use_start    { id, name, input }                    # §4.4
tool_use_running  { id, partialOutput?: string }         # §4.4 status
tool_use_end      { id, result: TextContent[], isError } # §4.5 / §4.12
permission_ask    { id, prompt: string, patterns: [] }   # §4.7
status_change     { active: "thinking" | "<tool>" | null } # activity line, §4.3/§4.4
error             { message, recoverable: boolean }      # §4.11
stop              { reason }
compact_start     { tokensBefore }                       # §4.14 — flips status indicator on
compact_end       { tokensAfter }                        # §4.14 — flips off
```

**Notably absent:** no event for "model is thinking with no text yet"
— that's just `status_change("thinking")`. The activity line is
state-driven, not event-driven.

### TUI module layout (M3 target)

```
packages/tui/src/
  index.ts            # public exports
  renderer.ts         # differential renderer (the ~300 LOC heart)
  terminal.ts         # raw stdin, ANSI helpers, resize, mouse
  components/
    transcript.ts     # the scrolling chat area
    input-box.ts      # the bordered input
    status-bar.ts     # the two-row bottom strip
    activity-line.ts  # the spinner-with-label above input
    slash-palette.ts  # the floating command picker
    permission.ts     # inline permission prompt
  theme/
    index.ts          # role lookup, ANSI emit helpers
    default.ts        # the only theme in v1
  keys.ts             # key parser (incl. mouse-wheel SGR sequences)
```

Total target: **<1500 LOC** for `packages/tui/` in v1.

---

## 11. Sign-off

This doc is locked. Any visual change needs to be proposed as an edit
to this file before it lands in code. M3 implementation now follows
this spec as the source of truth.
