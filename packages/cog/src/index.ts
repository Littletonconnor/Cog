import { printHelpMessage } from './help.js';
import { cli } from './parser.js';

export function main() {
  try {
    const { values: cliFlags } = cli();
    const hasFlags = Object.values(cliFlags).some((v) => v);

    if (cliFlags.help || !hasFlags) {
      printHelpMessage();
    }
  } catch (error: unknown) {
    console.error(error);
    process.exit(1);
  }
}
