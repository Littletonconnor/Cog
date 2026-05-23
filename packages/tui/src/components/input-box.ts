/**
 * Three-line bordered input box at the bottom of the TUI (above the
 * status bar). Owns the user's typed buffer and the cursor position;
 * mutates them in response to `KeyEvent`s routed by the orchestrator.
 *
 * **Submit lifecycle is intentionally split.** This component handles
 * typing, deletion, and cursor movement, but it does **not** handle
 * Enter. When Enter arrives the orchestrator reads `getValue()`, calls
 * `clear()`, and dispatches the submission. The input box never knows
 * what happens to its buffer after submit — keeping it ignorant of
 * cross-cutting concerns (submission, redraw scheduling) is the same
 * separation the status bar and activity line follow.
 *
 * Multi-line input, history, paste handling, and horizontal scrolling
 * are deferred to M4 polish. M3 supports a single-line buffer.
 *
 * @see docs/TUI-DESIGN.md §4.2
 */

import type { KeyEvent } from '../keys.js';
import type { Component } from '../renderer.js';
import type { Theme } from '../theme/index.js';

const GLYPHS = {
  topLeft: '┌',
  topRight: '┐',
  bottomLeft: '└',
  bottomRight: '┘',
  horizontal: '─',
  vertical: '│',
  cursor: '▌',
  prompt: '>',
} as const;

/**
 * Number of non-buffer cells on the content row. The remaining space
 * (`width - FIXED_CHARS`) holds the buffer text plus right-side padding.
 *
 * Layout, column by column:
 *
 *   col  1: left border  `│`
 *   col  2: left padding ` `
 *   col  3: prompt       `>`
 *   col  4: prompt pad   ` `
 *   col  5: cursor       `▌`  (always present — sits in the buffer at cursorPos)
 *   col -2: right pad    ` `
 *   col -1: right border `│`
 *
 * Total: 7 fixed cells (2 borders + 2 inner pads + prompt + prompt pad +
 * cursor). If the layout changes (e.g. dropping the prompt or adding a
 * second prompt char), recount and update.
 */
const FIXED_CHARS = 7;

export class InputBox implements Component {
  /**
   * The text the user has typed so far. Mutated by `handleKey()`; reset
   * by `clear()`. Never larger than what one terminal row can display in
   * M3 (no horizontal scrolling yet — overflow wraps visually).
   */
  private buffer: string = '';

  /**
   * Insertion index into `buffer`. Invariant: `0 <= cursorPos <= buffer.length`.
   * `cursorPos === 0` means "before the first character"; `cursorPos === buffer.length`
   * means "after the last character." Edits insert *at* this index and
   * advance the cursor by one.
   */
  private cursorPos: number = 0;

  /**
   * Render the input box as three lines:
   *
   *   1. Top border:    `┌─...─┐` spanning the full terminal width.
   *   2. Content row:   `│ > <buffer with cursor at cursorPos> │`,
   *                     space-padded to the full width.
   *   3. Bottom border: `└─...─┘`.
   *
   * The cursor is drawn as a `▌` glyph inserted between the characters
   * at `buffer[cursorPos - 1]` and `buffer[cursorPos]`. The renderer's
   * diff treats each returned line as opaque, so any styling (theme
   * escapes) must already be embedded in the returned strings.
   *
   * Buffer overflow (longer than `width - 7`) is not yet handled —
   * deferred to M4 horizontal scrolling.
   */
  render(width: number, theme: Theme): string[] {
    const topLine = GLYPHS.topLeft + GLYPHS.horizontal.repeat(width - 2) + GLYPHS.topRight;

    const padding = Math.max(0, width - FIXED_CHARS - this.buffer.length);
    const content =
      this.buffer.slice(0, this.cursorPos) +
      theme.fg('accent') +
      GLYPHS.cursor +
      theme.reset() +
      this.buffer.slice(this.cursorPos);
    const dimVertical = theme.dim() + GLYPHS.vertical + theme.reset();

    const middleLine =
      dimVertical +
      ' ' +
      theme.fg('accent') +
      GLYPHS.prompt +
      theme.reset() +
      ' ' +
      content +
      ' '.repeat(padding) +
      ' ' +
      dimVertical;

    const bottomLine = GLYPHS.bottomLeft + GLYPHS.horizontal.repeat(width - 2) + GLYPHS.bottomRight;

    return [
      theme.dim() + topLine + theme.reset(),
      middleLine,
      theme.dim() + bottomLine + theme.reset(),
    ];
  }

  /**
   * Apply a `KeyEvent` to the buffer / cursor. Mutates internal state in
   * place; does not trigger a redraw (that's the orchestrator's job
   * after dispatch).
   *
   * Handles `char`, `backspace`, and `arrow` (left/right) events. Other
   * events (`enter`, `esc`, `ctrl-c`, `arrow` up/down) are no-ops here —
   * either the orchestrator handles them or they're deferred to a later
   * milestone.
   *
   * The implementation must preserve the cursor invariant
   * (`0 <= cursorPos <= buffer.length`) across every mutation.
   */
  handleKey(event: KeyEvent): void {
    switch (event.type) {
      case 'char':
        this.buffer =
          this.buffer.slice(0, this.cursorPos) + event.value + this.buffer.slice(this.cursorPos);
        this.cursorPos += event.value.length;
        return;
      case 'backspace':
        if (this.cursorPos > 0) {
          this.buffer =
            this.buffer.slice(0, this.cursorPos - 1) + this.buffer.slice(this.cursorPos);
          this.cursorPos--;
        }
        return;
      case 'arrow':
        if (event.dir === 'left' && this.cursorPos > 0) this.cursorPos--;
        if (event.dir === 'right' && this.cursorPos < this.buffer.length) this.cursorPos++;
        return;
      default:
        // no-op
        return;
    }
  }

  /**
   * Return the current buffer contents. Called by the orchestrator when
   * Enter arrives so it can dispatch the submission. Does not mutate;
   * pair with `clear()` to reset after reading.
   */
  getValue(): string {
    return this.buffer;
  }

  /**
   * Reset the input box to its initial state (empty buffer, cursor at 0).
   * Called by the orchestrator immediately after `getValue()` during the
   * submit cycle.
   */
  clear(): void {
    this.buffer = '';
    this.cursorPos = 0;
  }
}
