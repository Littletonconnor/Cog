import type { KeyEvent } from "../keys.js";
import type { Component, KeyHandler } from "../renderer.js";
import type { Theme } from "../theme/index.js";

type PermissionChoice = "yes" | "yes-always" | "no" | "type-something";
type Option = { value: PermissionChoice; label: string; description: string };
type ShowArgs = { prompt: string; patterns: string[] };

const OPTIONS: ReadonlyArray<Option> = [
  { value: "yes", label: "Yes", description: "Run this command once." },
  {
    value: "yes-always",
    label: "Yes, don't ask again",
    description: "Add the pattern to the session allowlist.",
  },
  {
    value: "no",
    label: "No",
    description: "Skip this command. The agent will not run the tool.",
  },
  {
    value: "type-something",
    label: "Type something",
    description: "Reply in your own words.",
  },
];

export class PermissionPrompt implements Component, KeyHandler {
  private prompt: string | null = null;
  private patterns: string[] = [];
  private selectedIndex: number = 0;
  private resolver: ((choice: PermissionChoice) => void) | null = null;

  render(width: number, theme: Theme) {
    return [];
  }

  show(args: ShowArgs): Promise<PermissionChoice> {
    return Promise.reject(new Error("not implemented"));
  }

  handleKey(event: KeyEvent) {}
}
