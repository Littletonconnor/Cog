/**
 * Borderless input region at the bottom of the TUI (above the status
 * bar). Owns the user's typed buffer and the cursor position; mutates
 * them in response to `KeyEvent`s routed by the orchestrator.
 *
 * **Variable height, edge-to-edge.** The region renders as `N` lines
 * where `N` is the number of wrapped content rows (minimum 1, even for
 * an empty buffer). The region grows downward as the buffer fills past
 * the per-row content width — soft wrap at character boundaries matches
 * Claude Code's prompt design: no `┌─...─┐` border, just the prefix
 * (`> ` on the first row, `  ` on continuation rows) followed by buffer
 * content extending to the right edge of the terminal. Horizontal
 * scrolling is explicitly not the model.
 *
 * **Submit lifecycle is intentionally split.** This component handles
 * typing, deletion, and cursor movement, but it does **not** handle
 * Enter. When Enter arrives the orchestrator reads `getValue()`, calls
 * `clear()`, and dispatches the submission. The input box never knows
 * what happens to its buffer after submit — keeping it ignorant of
 * cross-cutting concerns (submission, redraw scheduling) is the same
 * separation the status bar and activity line follow.
 *
 * Deferred to M4 polish: explicit newlines via `Shift+Enter`,
 * word-aware wrapping (M3 breaks at character boundaries), history,
 * bracketed paste, and `$EDITOR` mode.
 *
 * @see docs/TUI-DESIGN.md §4.9
 */

import type { KeyEvent } from "../keys.js";
import type { Component, KeyHandler } from "../renderer.js";
import type { Theme } from "../theme/index.js";

const GLYPHS = {
  prompt: "❯",
} as const;

/**
 * SGR escape pair that produces the cursor's reverse-video overlay.
 * `\x1b[7m` enables reverse (swap fg/bg for subsequent chars); `\x1b[27m`
 * turns it off without resetting other attributes. Wrapping a single
 * character in these gives a highlighted block with the character still
 * readable inside it — the cursor never hides the buffer.
 */
const CURSOR_ON = "\x1b[7m";
const CURSOR_OFF = "\x1b[27m";

/**
 * The result of wrapping a buffer for rendering. Carries the chunked
 * rows plus the cursor's grid position.
 *
 * Invariant: `rows[cursorRow]` always exists. If `cursorPos` would
 * land past the last chunked row (e.g. the cursor sits at an exact
 * wrap boundary), the helper appends empty rows until the cursor's
 * row exists.
 */
type WrappedBuffer = {
  rows: string[];
  cursorRow: number;
  cursorCol: number;
};

/**
 * Number of non-buffer cells on each content row. The remaining space
 * (`width - INNER_WIDTH_DELTA`) holds the buffer text. On the cursor
 * row, the character at `cursorCol` is wrapped in reverse-video SGR
 * escapes so the underlying character stays visible behind a
 * highlighted background.
 *
 * Layout, column by column (no borders — the input region is edge-to-edge):
 *
 *   col  1:           prompt or indent  `❯` on row 0, ` ` on continuation rows
 *   col  2:           prompt pad        ` `
 *   col  3..width:    buffer (cursor overlays one buffer column on cursorRow)
 *
 * Total: 2 fixed cells (prompt-or-indent + prompt pad). The cursor does
 * **not** consume an extra column — it restyles the column already
 * occupied by `buffer[cursorPos]` (or a virtual space when the cursor
 * sits past the buffer's end).
 */
const INNER_WIDTH_DELTA = 2;

export class InputBox implements Component, KeyHandler {
  /**
   * The text the user has typed so far. Mutated by `handleKey()`; reset
   * by `clear()`.
   */
  private buffer: string = "";

  /**
   * Insertion index into `buffer`. Invariant: `0 <= cursorPos <= buffer.length`.
   */
  private cursorPos: number = 0;

  /**
   * Render the input region at the given width. Returns `N` lines —
   * one per wrapped content row. No borders are drawn; the region is
   * edge-to-edge.
   *
   *   - Row 0:       `> <buffer-chunk-with-cursor>`
   *   - Rows 1..N-1: `  <buffer-chunk-with-cursor>` (continuation indent)
   *
   * `N` is at least 1 — an empty buffer still produces one content row
   * with the cursor at column 0. `N` grows as the buffer fills past
   * `width - INNER_WIDTH_DELTA` characters per row.
   *
   * On the row matching `cursorRow`, the character at `cursorCol` is
   * wrapped in reverse-video SGR escapes (`\x1b[7m` / `\x1b[27m`) so
   * the cursor renders as a one-column highlight with the underlying
   * character still visible inside it. When the cursor sits past the
   * end of a row's buffer text (empty row or end of a short last row),
   * the highlight renders on a virtual space at that column.
   *
   * Wrapping is at character boundaries. Word-aware wrapping is M4.
   *
   * The renderer's diff treats each returned line as opaque, so all
   * styling (theme escapes) is embedded directly in the returned strings.
   */
  render(width: number, theme: Theme): string[] {
    const innerWidth = width - INNER_WIDTH_DELTA;
    const { rows, cursorRow, cursorCol } = maybeWrapBuffer(
      this.buffer,
      this.cursorPos,
      innerWidth,
    );
    const styledPrompt = theme.dim() + GLYPHS.prompt + theme.reset();

    const contentLines: string[] = [];
    for (let i = 0; i < rows.length; i++) {
      const rowText = rows[i] ?? "";
      const prefix = i === 0 ? `${styledPrompt} ` : "  ";

      let visibleContent: string;
      if (i === cursorRow) {
        const padded = rowText.padEnd(cursorCol + 1, " ");
        const before = padded.slice(0, cursorCol);
        const under = padded.charAt(cursorCol);
        const after = padded.slice(cursorCol + 1);
        visibleContent = before + CURSOR_ON + under + CURSOR_OFF + after;
      } else {
        visibleContent = rowText;
      }

      contentLines.push(prefix + visibleContent);
    }

    return contentLines;
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
      case "char":
        this.buffer =
          this.buffer.slice(0, this.cursorPos) +
          event.value +
          this.buffer.slice(this.cursorPos);
        this.cursorPos += event.value.length;
        return;
      case "backspace":
        if (this.cursorPos > 0) {
          this.buffer =
            this.buffer.slice(0, this.cursorPos - 1) +
            this.buffer.slice(this.cursorPos);
          this.cursorPos--;
        }
        return;
      case "arrow":
        if (event.dir === "left" && this.cursorPos > 0) this.cursorPos--;
        if (event.dir === "right" && this.cursorPos < this.buffer.length)
          this.cursorPos++;
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
    this.buffer = "";
    this.cursorPos = 0;
  }
}

/**
 * Chunk a buffer into rows of at most `innerWidth` characters and locate
 *
 * Edge cases:
 *
 *   - **Empty buffer.** Returns `rows: [""]` so the input box always
 *     has at least one content row to draw.
 *   - **Cursor at a wrap boundary.** When `cursorPos` is an exact
 *     multiple of `innerWidth` on a full row, the cursor moves to the
 *     start of the next row (not the trailing edge of the current
 *     row). An empty row is appended if needed.
 *   - **Cursor far past the buffer.** Successive empty rows are
 *     appended until `rows[cursorRow]` exists.
 *
 * @param buffer       The full input text.
 * @param cursorPos    Insertion index into `buffer` (0..buffer.length).
 * @param innerWidth   Max characters per row before wrapping. Should
 *                     equal `width - INNER_WIDTH_DELTA` at the caller.
 */
function maybeWrapBuffer(
  buffer: string,
  cursorPos: number,
  innerWidth: number,
): WrappedBuffer {
  const rows: string[] = [];

  for (let i = 0; i < buffer.length; i += innerWidth) {
    rows.push(buffer.slice(i, i + innerWidth));
  }
  if (rows.length === 0) rows.push("");
  const cursorRow = Math.floor(cursorPos / innerWidth);
  const cursorCol = cursorPos % innerWidth;
  while (cursorRow >= rows.length) rows.push("");

  return {
    rows,
    cursorRow,
    cursorCol,
  };
}
