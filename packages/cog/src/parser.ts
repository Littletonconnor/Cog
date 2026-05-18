import { parseArgs } from 'node:util';

const CLI_OPTIONS = {
  help: { type: 'boolean' as const, short: 'h', default: false },
  mock: { type: 'string' as const, short: 'm' },
};

export function cli() {
  return parseArgs({
    options: CLI_OPTIONS,
  });
}
