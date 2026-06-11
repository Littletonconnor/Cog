/**
 * Differential renderer for Cog's TUI. Mounts a single root `Component`,
 * coalesces redraw requests into one frame per ~16ms tick, and repaints only
 * the lines that changed between the previous frame and the new one.
 *
 * Components are pure: they take a width and theme, return an array of
 * pre-styled lines. All mutation lives here — the renderer holds the previous
 * frame, runs the diff, and emits ANSI cursor-positioning + line-clear writes
 * for the changed range only.
 *
 * @see docs/TUI-DESIGN.md §7 (redraw policy) and docs/RESEARCH.md §2.
 */

import type { KeyEvent } from "./keys.js";
import type { TerminalHandle } from "./terminal.js";
import type { Theme } from "./theme/index.js";

/**
 * A pure renderable unit. Given the available width and the active theme,
 * returns one pre-styled string per output line (no trailing newlines).
 *
 * Components own their own wrapping at the given width and are responsible
 * for embedding ANSI escapes via the passed `theme`. The renderer treats
 * each line as an opaque string for diff purposes.
 */
export interface Component {
  render(width: number, theme: Theme): string[];
}

/**
 * Capability interface for components that consume keyboard input. Kept
 * separate from `Component` because the two concerns are orthogonal — not
 * every renderable component handles keys (the status bar, activity line,
 * and transcript don't), and a future scrollback or modal layer could
 * conceivably handle keys without rendering anything of its own. Classes
 * that do both responsibilities declare `implements Component, KeyHandler`.
 *
 * The orchestrator (M3.6) routes each `KeyEvent` to whichever component
 * currently owns input focus — typically the input box, or the permission
 * prompt while it's active. Implementations mutate their internal state
 * synchronously and return `void`; triggering a redraw afterwards is the
 * orchestrator's responsibility, not the handler's, so handlers stay
 * decoupled from the renderer.
 *
 * Implementations must accept every `KeyEvent` variant without throwing —
 * unrecognized events are silent no-ops. See `InputBox.handleKey` for the
 * established pattern (a discriminated-union `switch` with a `default`
 * that returns).
 */
export interface KeyHandler {
  handleKey(event: KeyEvent): void;
}

/** Target frame interval. ~60fps cap; multiple `scheduleRedraw()` calls
 * within a single tick collapse into one repaint. */
const REDRAW_INTERVAL_MS = 16;

export class Renderer {
  /** The mounted root component, or `null` before `mount()` is called. */
  private root: Component | null = null;

  /** The lines emitted by the most recent successful frame. Compared
   * against the next frame to compute the changed range. */
  private previousLines: string[] = [];

  /** Active coalescing timer; non-null means a redraw is pending. */
  private redrawTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    private readonly terminal: TerminalHandle,
    private readonly theme: Theme,
  ) {}

  /**
   * Attach the root component and trigger an initial paint. The component's
   * `render()` will be called on the next redraw tick with the current
   * terminal width.
   */
  mount(root: Component) {
    this.root = root;
    this.scheduleRedraw();
  }

  /**
   * Detach the root component and release event-loop resources. Cancels
   * any pending redraw timer and clears the root reference so a stale
   * `setTimeout` callback can't write ANSI escapes after the orchestrator
   * has already torn down the terminal.
   *
   * Called from `TUI.stop()`. Without this, the renderer's coalescing
   * timer (a 16ms `setTimeout` outstanding when `stop()` fires) would
   * keep Node's event loop alive past process exit *and* would emit
   * cursor-positioning escapes into the user's restored shell when it
   * eventually fired. Matches the lifecycle contract of `mount()`.
   */
  unmount() {
    if (this.redrawTimer !== null) {
      clearTimeout(this.redrawTimer);
      this.redrawTimer = null;
    }
    this.root = null;
  }

  /**
   * Request a redraw. Idempotent within a single 16ms window — if a redraw
   * is already pending, subsequent calls are no-ops. Call this whenever
   * application state changes; the renderer takes care of batching.
   */
  scheduleRedraw() {
    if (this.redrawTimer !== null) return;
    this.redrawTimer = setTimeout(() => {
      this.redrawTimer = null;
      this.redraw();
    }, REDRAW_INTERVAL_MS);
  }

  /**
   * Run one diff + repaint cycle. Renders the root, walks the new and
   * previous line arrays in parallel to find the first and last changed
   * indices, and rewrites only that range. If nothing changed, emits zero
   * ANSI bytes.
   *
   * The frame is wrapped in `syncOutputStart` / `syncOutputEnd` so terminals
   * that support synchronized output commit the entire repaint atomically
   * (no tearing).
   */
  private redraw() {
    if (this.root === null) return;
    const { columns } = this.terminal.dimensions();
    const newLines = this.root.render(columns, this.theme);

    // Find first and last changed line indices
    let firstChanged = -1;
    let lastChanged = -1;

    const maxLength = Math.max(newLines.length, this.previousLines.length);
    for (let i = 0; i < maxLength; i++) {
      if (newLines[i] !== this.previousLines[i]) {
        if (firstChanged === -1) firstChanged = i;
        lastChanged = i;
      }
    }

    // Nothing changed
    if (firstChanged === -1) return;

    this.terminal.syncOutputStart();
    for (let i = firstChanged; i <= lastChanged; i++) {
      this.terminal.cursorTo(i + 1, 1); // ANSI is 1-indexed
      this.terminal.clearLine();
      this.terminal.write(newLines[i] ?? "");
    }
    this.terminal.syncOutputEnd();

    this.previousLines = newLines;
  }
}
