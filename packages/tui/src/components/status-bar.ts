/**
 * Two-row status bar at the bottom of the TUI. Top row is the tilde-expanded
 * cwd (full width). Bottom row shows context usage on the left and the model
 * id + extended-thinking state on the right.
 *
 * Both rows render in `theme.fg('dim')` — the bar is secondary chrome, not focal
 * content. Width-aware degradation: when the bottom row's two halves can't
 * fit with a 2-char gap, the ` • thinking <state>` suffix drops first, then
 * the model id truncates from the right.
 *
 * Inspired by pi's status bar — see `~/oss/pi` for the reference layout.
 *
 * @see docs/TUI-DESIGN.md §5
 */

import { basename } from 'node:path';
import type { Component } from '../renderer.js';
import type { Theme } from '../theme/index.js';

/**
 * Compaction strategy for the context window. `auto` lets the runtime
 * decide when to summarize older messages; `manual` leaves it to the user.
 * Wired statically until M9 introduces the real toggle.
 */
type CompactionMode = 'auto' | 'manual';

const GAP = 2;

class StatusBar implements Component {
  /**
   * @param cwd            Tilde-expanded working directory. Caller is
   *                       responsible for normalization.
   * @param model          Canonical model id (e.g. `haiku-4-5`).
   * @param contextWindow  Total context window in raw tokens (e.g. 200_000).
   * @param tokensUsed     Tokens consumed so far in the current session.
   * @param mode           Compaction mode. Defaults to `auto`.
   * @param thinking       Whether extended thinking is on. Defaults to false.
   */
  constructor(
    private readonly cwd: string,
    private readonly model: string,
    private readonly contextWindow: number,
    private tokensUsed: number,
    private readonly mode: CompactionMode = 'auto',
    private readonly thinking: boolean = false,
  ) {}

  /**
   * Render the two-row status bar at the given terminal width. Returns
   * exactly two strings (top, bottom), each pre-styled with the theme's
   * dim escape and a trailing reset.
   *
   * Width-fitting strategy for the bottom row, in order:
   *   1. Try `<usage>  ...  <model> • thinking <state>`.
   *   2. If too wide, drop the ` • thinking <state>` suffix.
   *
   * The top row's cwd truncates from the left (`~/.../<basename>`) when
   * longer than the available width.
   */
  render(width: number, theme: Theme) {
    const left = `${pct(this.tokensUsed, this.contextWindow)}/${kFmt(this.contextWindow)} (${this.mode})`;
    let right = `${this.model} • thinking ${this.thinking ? 'on' : 'off'}`;

    if (left.length + right.length + GAP > width) {
      right = this.model;
    }

    const top = truncateLeft(this.cwd, width);
    const bottom = padBetween(left, right, width);

    return [theme.fg('dim') + top + theme.reset(), theme.fg('dim') + bottom + theme.reset()];
  }

  setTokens(tokens: number) {
    this.tokensUsed = tokens;
  }
}

/**
 * Format a usage ratio as a one-decimal percentage. `pct(11_000, 200_000)`
 * returns `"5.5%"`. Returns `"NaN%"` if `total` is 0 — callers should
 * guard or pass non-zero windows.
 */
function pct(used: number, total: number) {
  return `${((used / total) * 100).toFixed(1)}%`;
}

/**
 * Render a token count as a `k`-rounded string. `kFmt(200_000)` returns
 * `"200k"`. No decimals; intended for display alongside the percentage
 * which already carries the precision.
 */
function kFmt(n: number) {
  return `${Math.round(n / 1000)}k`;
}

/**
 * Shorten a path from the left when it exceeds `maxLength` characters.
 * Replaces the prefix with `~/.../` and keeps only the basename, so the
 * directory the user actually cares about (the cwd's leaf) stays visible.
 *
 * Returns the input unchanged when it already fits. Does not normalize
 * tilde — caller is responsible for that.
 */
function truncateLeft(str: string, maxLength: number) {
  if (str.length > maxLength) {
    return `~/.../${basename(str)}`;
  }

  return str;
}

/**
 * Lay two strings out across the given width with all-space padding in
 * between. `padBetween("a", "b", 5)` returns `"a   b"`.
 *
 * If `left + right` is wider than `width`, falls back to a hard truncate
 * (`(left + right).slice(0, width)`). Callers that need graceful
 * degradation (drop optional suffixes, truncate one side preferentially)
 * should shrink the inputs before calling.
 */
function padBetween(left: string, right: string, width: number) {
  const gap = width - left.length - right.length;
  if (gap < 0) {
    return (left + right).slice(0, width);
  }

  return left + ' '.repeat(Math.max(gap, 0)) + right;
}

export type { CompactionMode };
export { StatusBar };
