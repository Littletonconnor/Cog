import fs from 'node:fs/promises';
import { setTimeout as sleep } from 'node:timers/promises';

import type { Provider, ProviderInput, ScenarioFile, StreamEvent } from './types.js';

export class MockProvider implements Provider {
  constructor(private readonly filePath: string) {}

  async *stream(input: ProviderInput): AsyncIterable<StreamEvent> {
    const scenario = await loadScenarioFile(this.filePath);
    validateScenarioFile(scenario, this.filePath);

    for (const event of scenario.events) {
      if (input.signal?.aborted) {
        yield { type: 'stop', reason: 'aborted' };
        return;
      }

      await sleep(event.delayMs ?? 0);
      yield event;
    }
  }
}

async function loadScenarioFile(filePath: string) {
  const raw = await fs.readFile(filePath, 'utf8');
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new Error(`Failed to load scenario from "${filePath}": invalid JSON (${reason}).`);
  }

  return parsed;
}

function validateScenarioFile(parsed: unknown, filePath: string): asserts parsed is ScenarioFile {
  if (typeof parsed !== 'object' || parsed === null) {
    throw new Error(
      `Failed to load scenario from "${filePath}": expected a JSON object, got ${
        parsed === null ? 'null' : typeof parsed
      }.`,
    );
  }

  if (!('events' in parsed)) {
    throw new Error(`Failed to load scenario from "${filePath}": missing "events" field.`);
  }

  if (!Array.isArray(parsed.events)) {
    throw new Error(
      `Failed to load scenario from "${filePath}": "events" must be an array, got ${typeof parsed.events}.`,
    );
  }

  if (parsed.events.length === 0) {
    throw new Error(
      `Failed to load scenario from "${filePath}": "events" must be a non-empty array.`,
    );
  }

  const last = parsed.events[parsed.events.length - 1];
  const lastDesc =
    typeof last === 'object' && last !== null && 'type' in last
      ? `type "${String(last.type)}"`
      : `${last === null ? 'null' : typeof last}`;
  if (typeof last !== 'object' || last === null || !('type' in last) || last.type !== 'stop') {
    throw new Error(
      `Failed to load scenario from "${filePath}": last event must have type "stop", got ${lastDesc}.`,
    );
  }
}
