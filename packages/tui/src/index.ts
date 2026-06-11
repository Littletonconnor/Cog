import type { StreamEvent } from "providers";
import { ActivityLine } from "./components/activity-line.js";
import { InputBox } from "./components/input-box.js";
import { PermissionPrompt } from "./components/permission-prompt.js";
import { StatusBar } from "./components/status-bar.js";
import { Transcript } from "./components/transcript.js";
import { type Component, Renderer } from "./renderer.js";
import {
  altScreenExit,
  exitRawMode,
  onKey,
  setupTerminal,
  showCursor,
  terminalHandle,
} from "./terminal.js";
import { theme } from "./theme/default.js";
import type { Theme } from "./theme/index.js";

export class TUI implements Component {
  private renderer: Renderer | null = null;
  private unsubscribeKey: (() => void) | null = null;

  private transcript: Transcript;
  private activityLine: ActivityLine;
  private inputBox: InputBox;
  private permissionPrompt: PermissionPrompt;
  private statusBar: StatusBar;

  constructor() {
    this.transcript = new Transcript();
    this.activityLine = new ActivityLine(null);
    this.inputBox = new InputBox();
    this.permissionPrompt = new PermissionPrompt();
    this.statusBar = new StatusBar(process.cwd(), "mock", 200_000, 0);
  }

  render(width: number, theme: Theme): string[] {
    const transcriptLines = this.transcript.render(width, theme);
    const activityLines = this.activityLine.render(width, theme);
    const isPromptActive = this.permissionPrompt.isActive();
    const promptLines = isPromptActive
      ? this.permissionPrompt.render(width, theme)
      : [];
    const inputLines = isPromptActive ? [] : this.inputBox.render(width, theme);
    const statusLines = this.statusBar.render(width, theme);

    return [
      ...transcriptLines,
      ...activityLines,
      ...promptLines,
      ...inputLines,
      ...statusLines,
    ];
  }

  start() {
    setupTerminal();
    this.renderer = new Renderer(terminalHandle, theme);
    this.renderer.mount(this);
    this.unsubscribeKey = onKey((event) => {
      const target = this.permissionPrompt.isActive()
        ? this.permissionPrompt
        : this.inputBox;
      target.handleKey(event);
      this.renderer?.scheduleRedraw();
    });
  }

  stop() {
    this.renderer?.unmount();
    this.unsubscribeKey?.();
    this.unsubscribeKey = null;
    process.stdout.write("\x1b[0m");
    showCursor();
    altScreenExit();
    exitRawMode();
    process.stdin.pause();
    process.stdout.write("\r\n");
    this.renderer = null;
  }

  async handleEvent(event: StreamEvent) {
    this.renderer?.scheduleRedraw();
    switch (event.type) {
      case "text_delta":
        this.transcript.appendAssistantDelta(event.delta);
        break;
      case "tool_use_start":
        this.transcript.startTool(event.id, event.name, event.input);
        break;
      case "tool_use_running":
        if (event.partialOutput !== undefined) {
          this.transcript.updateTool(event.id, event.partialOutput);
        }
        break;
      case "tool_use_end":
        this.transcript.finalizeTool(
          event.id,
          event.result.map((c) => c.text).join("\n"),
          event.isError,
        );
        break;
      case "permission_ask":
        // M6 will route this back to the tool-dispatch decision
        await this.permissionPrompt.show({
          prompt: event.prompt,
          patterns: event.patterns,
        });
        break;
      case "status_change":
        this.activityLine.setLabel(event.active);
        break;
      case "error":
        this.transcript.appendError(event.message, event.recoverable);
        break;
      case "stop":
        this.activityLine.setLabel(null);
        break;
      case "compact_start":
        // TODO: NO visual indicator (deferred); no-op
        break;
      case "compact_end":
        this.statusBar.setTokens(event.tokensAfter);
        break;
      default:
        const _exhaustive: never = event;
        break;
    }
    this.renderer?.scheduleRedraw();
  }
}

export { onKey } from "./terminal.js";
