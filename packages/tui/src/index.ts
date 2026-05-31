import { ActivityLine } from './components/activity-line.js';
import { InputBox } from './components/input-box.js';
import { PermissionPrompt } from './components/permission-prompt.js';
import { StatusBar } from './components/status-bar.js';
import { Transcript } from './components/transcript.js';
import type { Component } from './renderer.js';
import type { Theme } from './theme/index.js';

export class TUI implements Component {
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
    this.statusBar = new StatusBar(process.cwd(), 'mock', 200_000, 0);
  }

  render(width: number, theme: Theme): string[] {
    const transcriptLines = this.transcript.render(width, theme);
    const activityLines = this.activityLine.render(width, theme);
    const promptLines = this.permissionPrompt.render(width, theme);
    const inputLines = promptLines.length > 0 ? [] : this.inputBox.render(width, theme);
    const statusLines = this.statusBar.render(width, theme);

    return [...transcriptLines, ...activityLines, ...promptLines, ...inputLines, ...statusLines];
  }

  start() {}

  stop() {}

  handleEvent(_event: unknown) {}
}
