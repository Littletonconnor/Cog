import { MockProvider } from 'providers';
import { onKey, TUI } from 'tui';
import { printHelpMessage } from './help.js';
import { cli } from './parser.js';

export async function main() {
  try {
    const { values: cliFlags } = cli();
    const hasFlags = Object.values(cliFlags).some((v) => v);

    if (cliFlags.help || !hasFlags) {
      printHelpMessage();
    } else if (cliFlags.mock) {
      const controller = new AbortController();
      process.once('SIGINT', () => controller.abort());
      const mockProvider = new MockProvider(cliFlags.mock);
      const events = mockProvider.stream({
        messages: [],
        model: 'mock',
        signal: controller.signal,
      });
      const tui = new TUI();
      tui.start();
      try {
        for await (const event of events) {
          await tui.handleEvent(event);
        }
        await new Promise<void>((resolve) => {
          const unsubscribe = onKey((event) => {
            if (event.type === 'esc' || event.type === 'ctrl-c') {
              unsubscribe();
              resolve();
            }
          });
        });
      } finally {
        tui.stop();
      }
    }
  } catch (error: unknown) {
    console.error(error);
    process.exit(1);
  }
}
