/**
 * Inline permission prompt rendered in the slot normally occupied by
 * the input box. Activated by the orchestrator on a `permission_ask`
 * StreamEvent — the agent wants to run a tool that requires approval.
 *
 * **Arrow-nav popover, not single-key shortcuts.** A vertical list of
 * options with one highlighted; user navigates via arrow keys or Tab,
 * confirms with Enter, dismisses with Esc. Single-key shortcuts
 * (y/a/n/N) are intentionally not supported — they're discoverable
 * only if you know them, and one fat-finger can authorize a
 * destructive action. Matches Claude Code, pi, and OpenCode.
 *
 * **Two states**: dormant (`prompt === null`, `resolver === null` —
 * `render` returns `[]`) and active (both set, `render` returns the
 * prompt UI). The orchestrator removes the input box from rendering
 * while active and routes every `KeyEvent` here instead.
 *
 * @see docs/TUI-DESIGN.md §4.7
 */

import type { KeyEvent } from '../keys.js';
import type { Component, KeyHandler } from '../renderer.js';
import type { Theme } from '../theme/index.js';

/**
 * The user's answer to a permission ask. Resolved by `show()`'s Promise.
 *
 *   - `yes` — run the tool once.
 *   - `yes-always` — run the tool *and* add the wire-supplied patterns
 *     to the session allowlist so equivalent calls don't prompt again.
 *   - `no` — skip the tool entirely. Also returned by Esc.
 *   - `type-something` — user wants to respond freely. The orchestrator
 *     interprets this as "dismiss the prompt, hand focus to the input
 *     box"; the user's next message is delegated to the agent loop.
 *     The permission-prompt itself does **not** embed a text input —
 *     typing stays the input box's job.
 */
type PermissionChoice = 'yes' | 'yes-always' | 'no' | 'type-something';

/**
 * One row in the options list. `value` is what the Promise resolves
 * to; `label` and `description` are the strings the renderer paints
 * (label in accent on the selected row, description always dim).
 */
type Option = { value: PermissionChoice; label: string; description: string };

/**
 * Inputs to `show()`. `prompt` is the human-readable question; `patterns`
 * are the wire-supplied glob patterns that would be added to the
 * allowlist if the user picks `yes-always`.
 */
type ShowArgs = { prompt: string; patterns: string[] };

/**
 * Horizontal gap subtracted from `width` when wrapping the header so
 * the wrapped text doesn't run flush to the right edge of the terminal.
 */
const GAP = 2;

/**
 * Glyphs the prompt paints. Currently just the caret used to mark the
 * selected option; matches the input-box's `❯` for visual continuity
 * across stateful components.
 */
const GLYPHS = {
  prompt: '❯',
} as const;

/**
 * The four options in display order. Index in this array maps directly
 * to `selectedIndex`. Option 3 (`type-something`) is the escape hatch;
 * `render` draws a dim horizontal rule above it to mark the visual
 * break between direct answers and "reply in your own words."
 */
const OPTIONS: ReadonlyArray<Option> = [
  { value: 'yes', label: 'Yes', description: 'Run this command once.' },
  {
    value: 'yes-always',
    label: "Yes, don't ask again",
    description: 'Add the pattern to the session allowlist.',
  },
  {
    value: 'no',
    label: 'No',
    description: 'Skip this command. The agent will not run the tool.',
  },
  {
    value: 'type-something',
    label: 'Type something',
    description: 'Reply in your own words.',
  },
];

export class PermissionPrompt implements Component, KeyHandler {
  /**
   * The current prompt's question text, or `null` when dormant. Set
   * by `show()`, cleared by `clear()`. Invariant: `prompt` and
   * `resolver` are both non-null (active) or both null (dormant) —
   * they're set and cleared together.
   */
  private prompt: string | null = null;

  /**
   * Wire-supplied patterns to be added to the session allowlist if
   * the user picks `yes-always`. Stored on the component because the
   * choice is made here but the allowlist mutation happens upstream —
   * the orchestrator / agent loop needs a way to retrieve the patterns
   * alongside the choice. Cleared on resolution.
   */
  private patterns: string[] = [];

  /**
   * Index of the currently-highlighted option within `OPTIONS`. Reset
   * to 0 (Yes) on every `show()` so the default highlight is stable.
   * Clamped to `[0, OPTIONS.length - 1]` by `moveSelection`.
   */
  private selectedIndex: number = 0;

  /**
   * The pending `show()` Promise's resolve function, or `null` when
   * dormant. Called exactly once per `show()` cycle — by `handleKey`
   * on Enter (with `OPTIONS[selectedIndex].value`) or Esc (with
   * `"no"`). Cleared via `clear()` immediately after.
   *
   * No rejector field: the prompt never rejects in M3. External
   * cancellation (Ctrl-C, `stop` event mid-prompt) is parked for
   * later; see Follow-ups in `docs/TODO.md`.
   */
  private resolver: ((choice: PermissionChoice) => void) | null = null;

  /**
   * Render the prompt UI when active, `[]` when dormant. Layout:
   *
   *   - Wrapped prompt text (indented).
   *   - Blank line.
   *   - For each option: a label row (caret + number + label) and a
   *     description row (5-space indent, dim).
   *   - A dim horizontal rule above the `type-something` option,
   *     separating direct answers from the escape hatch.
   *   - Blank line.
   *   - Dim help line: `Enter to select · Tab/Arrow keys to navigate · Esc to cancel`.
   *
   * The renderer's diff treats each returned line as opaque; all
   * styling (theme escapes) is embedded directly in the strings.
   */
  render(width: number, theme: Theme) {
    if (this.prompt === null) return [];

    const lines: string[] = [];

    for (const headerLine of wrapText(this.prompt, width - GAP)) {
      lines.push(`  ${headerLine}`);
    }
    lines.push('');

    for (let i = 0; i < OPTIONS.length; i++) {
      const option = OPTIONS[i];
      if (option.value === 'type-something') {
        lines.push(`  ${theme.dim()}${'─'.repeat(width - 4)}${theme.reset()}`);
      }
      const isSelected = i === this.selectedIndex;
      const caret = isSelected ? `${theme.fg('accent') + GLYPHS.prompt} ${theme.reset()}` : '  ';
      const label = isSelected
        ? `${theme.fg('accent')}${i + 1}. ${option.label}${theme.reset()}`
        : `${i + 1}. ${option.label}`;
      lines.push(caret + label);
      lines.push(`     ${theme.dim()}${option.description}${theme.reset()}`);
    }
    lines.push('');

    lines.push(
      '  ' +
        theme.dim() +
        'Enter to select · Tab/Arrow keys to navigate · Esc to cancel' +
        theme.reset(),
    );

    return lines;
  }

  /**
   * Activate the prompt with a question and the wire-supplied
   * allowlist patterns. Returns a Promise that resolves once the user
   * commits a choice (Enter on a selected option, or Esc which
   * resolves to `"no"`).
   *
   * **Throws on re-entry.** Calling `show()` while the prompt is
   * already active is a programming bug — the orchestrator should
   * await each Promise before triggering another permission ask.
   * Fail-loud surfaces the bug at the call site rather than silently
   * orphaning the previous Promise.
   *
   * Default selection on activation is option 0 (`Yes`) — matches
   * Claude Code. Destructive tools should warn in the prompt text
   * rather than rely on a different default.
   */
  show(args: ShowArgs): Promise<PermissionChoice> {
    if (this.resolver !== null) {
      throw new Error('PermissionPrompt.show(): already active');
    }
    this.prompt = args.prompt;
    this.patterns = args.patterns;
    this.selectedIndex = 0;
    return new Promise((resolve) => {
      this.resolver = resolve;
    });
  }

  /**
   * Dispatch a `KeyEvent` to navigation or resolution. No-op when
   * dormant (the orchestrator shouldn't route here when inactive, but
   * the early-return guard makes the component robust regardless).
   *
   * Mapped keys:
   *
   *   - `arrow` up / `tab` back → decrement selection
   *   - `arrow` down / `tab` forward → increment selection
   *   - `arrow` left / right → no-op (no horizontal navigation)
   *   - `enter` → resolve with `OPTIONS[selectedIndex].value`, clear
   *   - `esc` → resolve with `"no"`, clear
   *   - everything else (`char`, `backspace`, `ctrl-c`) → no-op
   *
   * `ctrl-c` is the orchestrator's concern (hard abort the turn), not
   * the prompt's. Digit shortcuts (1–4) are intentionally not
   * supported — keep the navigation surface minimal.
   */
  handleKey(event: KeyEvent) {
    if (this.resolver === null) return;

    switch (event.type) {
      case 'arrow':
        if (event.dir === 'up') this.moveSelection(-1);
        if (event.dir === 'down') this.moveSelection(1);
        return;
      case 'tab':
        if (event.dir === 'forward') this.moveSelection(1);
        if (event.dir === 'back') this.moveSelection(-1);
        return;
      case 'enter':
        this.resolver(OPTIONS[this.selectedIndex].value);
        this.clear();
        return;
      case 'esc':
        this.resolver('no');
        this.clear();
        return;
      default:
        return;
    }
  }

  /**
   * Adjust `selectedIndex` by `delta`, clamped to
   * `[0, OPTIONS.length - 1]`. `-1` moves the highlight up (toward
   * option 0); `+1` moves it down. Both arrow up/down and Tab/Shift-Tab
   * route through here so the clamp logic lives once.
   */
  private moveSelection(delta: number) {
    this.selectedIndex = Math.max(0, Math.min(OPTIONS.length - 1, this.selectedIndex + delta));
  }

  /**
   * Reset all state to dormant. Called immediately after every
   * `resolver(...)` call so the next `show()` starts fresh. Resets
   * `selectedIndex` to 0 so a second `show()` opens with the default
   * highlight rather than wherever the previous prompt was last
   * selected.
   */
  private clear() {
    this.prompt = null;
    this.patterns = [];
    this.selectedIndex = 0;
    this.resolver = null;
  }
}

/**
 * Char-wrap a string into rows of at most `width` characters. Returns
 * `[""]` for an empty string so callers can always render at least
 * one line. Local copy of `transcript.ts`'s helper; the eventual
 * extraction to a shared util is filed under TODO Follow-ups.
 */
function wrapText(text: string, width: number) {
  if (text === '') return [''];
  const lines: string[] = [];
  for (let i = 0; i < text.length; i += width) {
    lines.push(text.slice(i, i + width));
  }
  return lines;
}
