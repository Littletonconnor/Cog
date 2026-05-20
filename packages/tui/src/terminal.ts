/**
 * Low-level terminal primitives for Cog's TUI: ANSI escape helpers, raw-mode
 * lifecycle, dimension detection, and a cleanup registry.
 *
 * Everything here is side-effecting on `process.stdin` / `process.stdout`.
 * Higher layers (renderer, components) compose these into atomic frame writes.
 *
 * @see docs/TUI-DESIGN.md §7 (animation / redraw policy) and §8 (width handling).
 */

import { type KeyEvent, parseInput } from './keys.js';

const ESC = '\x1b[';

/** Fallback width when stdout isn't a TTY (e.g. output is piped). */
const COLUMNS = 80;

/** Fallback height when stdout isn't a TTY. */
const ROWS = 24;

/**
 * Entry point for the TUI's terminal lifecycle. Validates width, enters raw mode + alt screen,
 * hides the cursor, and registers cleanup tasks so the terminal is restored exactly as it was on exit.
 *
 * Calls this once at TUI startup. Must run before any rendering.
 */
export function setupTerminal() {
  const { columns } = dimensions();
  if (columns < 60) {
    process.stderr.write('cog needs a terminal at least 60 cols wide\n');
    process.exit(1);
  }

  enterRawMode();
  altScreenEnter();
  hideCursor();

  registerCleanup(exitRawMode);
  registerCleanup(altScreenExit);
  registerCleanup(showCursor);
}

/**
 * Move the terminal cursor to the given (row, col) position. Both are
 * 1-indexed per the CSI H spec. Used by the renderer when emitting a frame
 * diff to position the next write.
 *
 * ANSI: `CSI <row>;<col> H`
 */
export function cursorTo(row: number, col: number) {
  process.stdout.write(`${ESC}${row};${col}H`);
}

/**
 * Clear the entire current line, regardless of cursor position. Used by the
 * renderer before rewriting a changed line.
 *
 * ANSI: `CSI 2 K`
 */
export function clearLine() {
  process.stdout.write(`${ESC}2K`);
}

/**
 * Hide the terminal cursor. Called once at TUI startup so the renderer's own
 * block-cursor markers are the only ones visible.
 *
 * ANSI: DECTCEM off (`CSI ? 25 l`)
 */
export function hideCursor() {
  process.stdout.write(`${ESC}?25l`);
}

/**
 * Show the terminal cursor. Called from cleanup so the user gets their cursor
 * back when cog exits.
 *
 * ANSI: DECTCEM on (`CSI ? 25 h`)
 */
export function showCursor() {
  process.stdout.write(`${ESC}?25h`);
}

/**
 * Begin a synchronized-output region. Terminals that support this sequence
 * buffer subsequent writes and commit them atomically when `syncOutputEnd()`
 * fires — eliminates tearing during frame redraws.
 *
 * ANSI: `CSI ? 2026 h`
 */
export function syncOutputStart() {
  process.stdout.write(`${ESC}?2026h`);
}

/**
 * End a synchronized-output region. Commits everything written since the
 * matching `syncOutputStart()`. No-op on terminals that don't support the
 * sequence.
 *
 * ANSI: `CSI ? 2026 l`
 */
export function syncOutputEnd() {
  process.stdout.write(`${ESC}?2026l`);
}

/**
 * Switch the terminal to its alternate screen buffer. Saves the user's shell
 * history; the original buffer is restored by `altScreenExit()`. Without this,
 * the TUI would scribble over the user's scrollback.
 *
 * ANSI: `CSI ? 1049 h`
 */
export function altScreenEnter() {
  process.stdout.write(`${ESC}?1049h`);
}

/**
 * Exit the alternate screen buffer and restore the user's shell history
 * exactly as it was before `altScreenEnter()`.
 *
 * ANSI: `CSI ? 1049 l`
 */
export function altScreenExit() {
  process.stdout.write(`${ESC}?1049l`);
}

/**
 * Switch stdin to raw mode so keystrokes (Esc, Ctrl-C, arrows) arrive as
 * bytes immediately instead of being line-buffered by the kernel.
 *
 * Throws if stdin isn't a TTY (e.g. when stdin is piped) — raw mode is a
 * TTY-only feature. Pair with `exitRawMode()` to restore line-buffered mode
 * on shutdown.
 */
export function enterRawMode() {
  if (!process.stdin.isTTY) {
    throw new Error('cog requires a TTY (raw mode unavailable)');
  }

  process.stdin.setRawMode(true);
  process.stdin.resume();
}

/**
 * Restore stdin to line-buffered mode. No-op when stdin isn't a TTY, so it's
 * safe to call as a cleanup task even when `enterRawMode()` was skipped.
 */
export function exitRawMode() {
  if (process.stdin.isTTY) {
    process.stdin.setRawMode(false);
  }
}

/**
 * Current terminal dimensions in columns and rows. Falls back to 80×24 when
 * stdout isn't a TTY (e.g. when output is piped) so the TUI can still render
 * a frame for tests / snapshots.
 */
export function dimensions() {
  return {
    columns: process.stdout.columns ?? COLUMNS,
    rows: process.stdout.rows ?? ROWS,
  };
}

/**
 * Subscribe to terminal resize events. The callback fires with the new
 * dimensions every time the user resizes the window.
 *
 * Returns an unsubscribe function — call it during teardown so the listener
 * doesn't outlive the TUI session.
 */
export function onResize(callback: (dimensions: { columns: number; rows: number }) => void) {
  const handler = () => callback(dimensions());
  process.stdout.on('resize', handler);
  return () => process.stdout.off('resize', handler);
}

/**
  * Subscribe to parsed key events from stdin. Requires raw mode to be
  active * so keystrokes arrive as individual buffers rather than line-buffered input.
  *
  * Each `data` chunk is fed through `parseInput()` which may yield multiple
  * `KeyEvent`s (e.g. pasted text). The callback fires once per event.
  *
  * Returns an unsubscribe function — call it during teardown.
*/
export function onKey(callback: (event: KeyEvent) => void) {
  const handler = (chunk: Buffer) => {
    for (const event of parseInput(chunk)) {
      callback(event);
    }
  };

  process.stdin.on('data', handler);
  return () => process.stdin.off('data', handler);
}

const cleanupTasks: Array<() => void> = [];

/**
 * Register a cleanup task to run on process exit. Tasks fire in LIFO order
 * (last registered, first run) so the terminal ends up exactly where it
 * started: show cursor → exit alt screen → drop raw mode.
 *
 * Errors thrown by tasks are swallowed so one bad task doesn't prevent the
 * rest from running.
 */
export function registerCleanup(task: () => void) {
  cleanupTasks.push(task);
}

/**
 * Run every registered cleanup task in LIFO order. Called automatically on
 * `process.exit`. Idempotent — clears the task list after running so a
 * second call is a no-op.
 */
export function runCleanup() {
  for (const task of [...cleanupTasks].reverse()) {
    try {
      task();
    } catch {
      // Swallow and allow other tasks to cleanup without crashing
    }
  }

  cleanupTasks.length = 0;
}

/**
 * Auto-fire `runCleanup` on process exit. Catches the common termination
 * paths: explicit `process.exit()` calls, Node's default SIGINT / SIGTERM
 * handling, and natural event-loop drain.
 *
 * Doesn't catch crashes or external signals when another part of the app has
 * registered its own SIGINT / SIGTERM listener (Node suppresses the default
 * handler in that case). For belt-and-suspenders coverage, also wire
 * `process.once("SIGINT", ...)`, `"SIGTERM"`, and `"uncaughtException"`
 * listeners that call `runCleanup` before exiting.
 */
process.once('exit', runCleanup);
process.once('SIGINT', () => {
  runCleanup();
  process.exit(130);
});
process.once('SIGTERM', () => {
  runCleanup();
  process.exit(143);
});
process.once('uncaughtException', (error) => {
  runCleanup();
  console.error(error);
  process.exit(143);
});

export type TerminalHandle = {
  write: (s: string) => void;
  cursorTo: (row: number, col: number) => void;
  clearLine: () => void;
  syncOutputStart: () => void;
  syncOutputEnd: () => void;
  dimensions: () => { columns: number; rows: number };
};
