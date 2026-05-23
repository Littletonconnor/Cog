/**
 * Single-line activity indicator that sits above the input box. Shows a
 * braille spinner glyph plus a label when the agent is doing something
 * (`thinking`, a tool name, etc.); renders as an empty line when idle.
 *
 * Stateless and time-driven: the visible frame is derived from `Date.now()`,
 * not from any internal counter. That means the component never needs to be
 * "reset" between mounts, and the animation rate is decoupled from how often
 * the renderer redraws. The trade-off — see the docstring on `render()`.
 *
 * @see docs/TUI-DESIGN.md §4.3
 */

import type { Component } from '../renderer.js';
import type { Theme } from '../theme/index.js';

/**
 * Braille spinner frames. Eight glyphs that read as a rotating dot when
 * cycled at ~12 fps. Ordered to visually spin clockwise.
 *
 * Terminals without braille support degrade to mojibake; the design doc
 * deferred the `|/-\` fallback to M4.
 */
const FRAMES = ['⣾', '⣽', '⣻', '⢿', '⡿', '⣟', '⣯', '⣷'] as const;

/**
 * Wall-clock interval between spinner frames in milliseconds. 80ms ≈ 12.5fps,
 * which feels active without being distracting. Independent of the renderer's
 * 16ms tick — the renderer can call `render()` at any cadence and the spinner
 * still advances on its own schedule.
 */
const FRAME_INTERVAL_MS = 80;

export class ActivityLine implements Component {
  /**
   * @param label  Human-readable activity description (`"thinking"`,
   *               `"read_file"`, etc.) or `null` when idle. The component
   *               itself is not mounted/unmounted on idle — it keeps its
   *               row in the layout and renders an empty line so the rest
   *               of the screen doesn't jump.
   */
  constructor(private readonly label: string | null) {}

  /**
   * Render the activity line for one frame.
   *
   * When `label` is `null`, returns a single empty string (preserves the
   * row in the layout — no jitter when activity starts or stops).
   *
   * When `label` is set, returns one line: `<spinner> <label>`. The
   * spinner glyph is chosen from `FRAMES` based on the current wall clock,
   * so successive calls within the same 80ms window render the same frame.
   *
   * **Caveat:** the renderer only repaints when `scheduleRedraw()` is
   * called. The orchestrator (M3.6) is responsible for ticking the
   * renderer at `FRAME_INTERVAL_MS` while a label is set; without that
   * external tick, the spinner freezes even though this method is
   * correctly time-driven.
   *
   * The `width` parameter is unused; the activity line is always one row
   * and callers pass short labels per `TUI-DESIGN.md §4.3`.
   */
  render(_: number, theme: Theme) {
    if (this.label === null) return [''];

    const frame = FRAMES[Math.floor(Date.now() / FRAME_INTERVAL_MS) % FRAMES.length];

    return [`${theme.fg('accent') + frame + theme.reset()} ${this.label}`];
  }
}
