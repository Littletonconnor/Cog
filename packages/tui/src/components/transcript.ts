/**
 * Scrolling chat transcript above the input box. Owns the chronological
 * list of "blocks" — user messages, streaming assistant messages, tool
 * calls, and errors — and concatenates each block's rendered lines into
 * a single output for the renderer.
 *
 * Blocks are *identities* that mutate over time, not immutable records.
 * An assistant block's `text` grows as `text_delta` events arrive; a
 * tool block's `status` transitions from `running` to `success`/`error`
 * as the tool executes. Mutation lives entirely behind `Transcript`'s
 * public methods — consumers should treat the `blocks` array as
 * read-only.
 *
 * Per `TUI-DESIGN.md §2.3`, user messages render with `theme.bg('user-bg')`
 * padded to full width; assistant, tool, and error messages render plain.
 *
 * @see docs/TUI-DESIGN.md §2.3, §4.5, §4.11
 */

import type { Component } from "../renderer.js";
import type { Theme } from "../theme/index.js";

/**
 * A tool invocation in the transcript. Created by `tool_use_start` with
 * `status: "running"`. `tool_use_running` events may arrive carrying a
 * partial-output snapshot — store the latest in `result`. `tool_use_end`
 * finalizes the block: `status` transitions to `success` (when
 * `isError: false`) or `error` (when `isError: true`), and `result`
 * holds the final output.
 *
 * Per `TUI-DESIGN.md §4.5`, finalized tool blocks collapse to the first
 * three lines of output by default; `success` renders in
 * `theme.fg('success')`, `error` in `theme.fg('danger')`.
 */
type ToolBlock = {
  type: "tool";
  id: string;
  name: string;
  input: unknown;
  status: "running" | "success" | "error";
  result?: string;
};

/**
 * A message submitted by the user (typed in the input box, committed
 * by pressing Enter). Immutable after creation — once the user presses
 * Enter the text is locked; the orchestrator never edits a user block.
 *
 * Per `TUI-DESIGN.md §2.3`, user messages render with the `user-bg`
 * background color padded to the full terminal width so the user's
 * turns visually anchor the conversation.
 */
type UserBlock = {
  type: "user";
  id: string;
  text: string;
};

/**
 * A streaming response from the assistant. Created when the first
 * `text_delta` of an assistant turn arrives; subsequent `text_delta`
 * events for the same turn append to `text` in place (mutable extension
 * — cheaper than re-creating the block per delta and lets the renderer's
 * diff repaint only the changed lines). Becomes effectively immutable
 * when a non-text event (e.g. `tool_use_start`, `stop`) signals the
 * turn has moved on.
 *
 * Renders plain — no background fill, default theme color — word-wrapped
 * at the available terminal width.
 */
type AssistantBlock = {
  type: "assistant";
  id: string;
  text: string;
};

/**
 * An error surfaced by the provider or agent loop. Created from an
 * `error` StreamEvent. `recoverable` drives the inline shortcuts the
 * UI renders below the message: `r` to retry and `q` to abort when
 * true, `q` only when false.
 *
 * Renders in `theme.fg('danger')` per `TUI-DESIGN.md §4.11`.
 */
type ErrorBlock = {
  type: "error";
  id: string;
  message: string;
  recoverable: boolean;
};

/**
 * One entry in the transcript. Discriminated on `type` — each variant
 * has its own lifecycle (see per-variant docs above).
 *
 * Every block carries a stable `id`. For `tool` blocks the id comes
 * from the `tool_use_*` wire events. For `user`, `assistant`, and
 * `error` blocks the orchestrator generates one (e.g.
 * `crypto.randomUUID()`) so subsequent mutations have something to
 * look up against.
 */
export type Block = ToolBlock | UserBlock | AssistantBlock | ErrorBlock;

/**
 * Mutable, in-memory representation of the transcript. Holds the
 * ordered list of blocks and exposes a targeted mutator per kind of
 * incoming event from the provider stream (text deltas, tool
 * lifecycle, errors) or from the user (Enter to submit).
 *
 * State is intentionally minimal: the blocks array plus a pointer to
 * the currently-streaming assistant block so `appendAssistantDelta`
 * can decide between extending the existing block and creating a new
 * one. All other lifecycle decisions live inside the mutator methods.
 */
export class Transcript implements Component {
  /**
   * The ordered list of blocks in the transcript, oldest first.
   * Mutated in place by the mutator methods; read-only from the
   * outside (the class exposes no getter — callers must treat blocks
   * as private state and read them only through `render`).
   */
  private blocks: Block[] = [];

  /**
   * Id of the assistant block currently receiving streaming text
   * deltas, or `null` when no assistant turn is in flight. Used by
   * `appendAssistantDelta` to decide between extending an existing
   * block and creating a new one. Reset to `null` by any mutator
   * that ends the current turn (`appendUser`, `startTool`,
   * `appendError`) and by `clear()`.
   */
  private currentAssistantId: string | null = null;

  /**
   * Concatenate every block's rendered lines into a single string
   * array for the parent renderer. Implementation deferred to chunk 3.
   */
  render(width: number, theme: Theme) {
    return [""];
  }

  /**
   * Append a new user message at the bottom of the transcript.
   * Called by the orchestrator when the user presses Enter and
   * submits the input buffer. Generates a fresh id; ends the current
   * assistant turn (resets `currentAssistantId`).
   */
  appendUser(text: string) {}

  /**
   * Extend the current streaming assistant block, or create a new
   * one if no turn is in flight. Called by the orchestrator on each
   * `text_delta` event. When creating, a fresh id is generated and
   * stored in `currentAssistantId`.
   *
   * `text` is the *delta* (the chunk that just arrived), not the
   * cumulative buffer — the method appends.
   */
  appendAssistantDelta(text: string) {}

  /**
   * Append a new tool block at the bottom of the transcript with
   * `status: "running"`. Called by the orchestrator on a
   * `tool_use_start` event. The `id` is the one carried by the wire
   * event so subsequent `updateTool` / `finalizeTool` calls can
   * locate this block.
   *
   * Ends any current assistant turn (resets `currentAssistantId`).
   */
  startTool(id: string, name: string, input: unknown) {}

  /**
   * Update the partial output on the existing tool block matching
   * `id`. Called by the orchestrator on `tool_use_running` when the
   * wire event carries a `partialOutput` snapshot. Replaces (not
   * appends to) the block's `result` field — wire partial outputs
   * are snapshots, not deltas.
   *
   * No-op if no tool block matches `id`.
   */
  updateTool(id: string, partialOutput: string) {}

  /**
   * Transition the existing tool block matching `id` from `running`
   * to `success` (when `isError` is false) or `error` (when true),
   * and store the final `result`. Called by the orchestrator on a
   * `tool_use_end` event.
   *
   * No-op if no tool block matches `id`.
   */
  finalizeTool(id: string, result: string, isError: boolean) {}

  /**
   * Append a new error block at the bottom of the transcript. Called
   * by the orchestrator on an `error` StreamEvent. `recoverable`
   * drives whether the rendered block shows both `r` (retry) and `q`
   * (abort) shortcuts or only `q` — see `TUI-DESIGN.md §4.11`.
   *
   * Ends any current assistant turn (resets `currentAssistantId`).
   */
  appendError(message: string, recoverable: boolean) {}

  /**
   * Reset the transcript to its initial empty state. Clears the
   * block list and the assistant-turn pointer. No StreamEvent carries
   * this — the orchestrator calls it (e.g., on a new session, or as
   * cleanup during testing).
   */
  clear() {}
}
