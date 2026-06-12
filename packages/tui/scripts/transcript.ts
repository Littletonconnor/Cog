import { Transcript } from '../components/transcript.js';
import { theme } from '../theme/default.js';

const WIDTH = 60;

/**
 * Build a fresh Transcript, run the provided setup to populate it via the
 * mutator methods, then render and print the result wrapped in `|...|`
 * guides so column alignment is easy to eyeball (user bars should fill
 * the full width; other lines should never exceed it).
 */
function show(label: string, setup: (t: Transcript) => void) {
  const transcript = new Transcript();
  setup(transcript);
  console.log(`=== ${label} ===`);
  console.log(`|${'-'.repeat(WIDTH)}|`);
  for (const line of transcript.render(WIDTH, theme)) {
    console.log(`|${line}|`);
  }
  console.log(`|${'-'.repeat(WIDTH)}|`);
  console.log();
}

// --- Case 1: single user message ---
show('single user message', (t) => {
  t.appendUser('Help me refactor the agent loop');
});

// --- Case 2: single user message with wrapping ---
show('single user message with wrapping', (t) => {
  t.appendUser(
    "Help me refactor the agent loop. Also help me figure out what is wrong with the agent loop. I am getting a 500 that i'm unable to understand myself",
  );
});

// --- Case 3: Assistant message ---
show('single assistant message', (t) => {
  t.appendAssistantDelta("I'm currently looking into what the user asked me");
});

// --- Case 4: Assistant message with wrapping ---
show('single assistant message with wrapping.', (t) => {
  t.appendAssistantDelta("I'm currently looking into what the user asked me.");
  t.appendAssistantDelta(
    "However I'm having trouble understand what the ask is. I should make sure to verify before implementing anything.",
  );
});

// --- Case 5: Tool lifecycle (start) ---
show('tool lifecycle (start)', (t) => {
  t.startTool('123', 'reading_file', 'reading file');
});

// --- Case 6: Tool lifecycle (finalize - success) ---
show('tool lifecycle (finalize - success)', (t) => {
  t.startTool('123', 'reading_file', 'reading file');
  t.finalizeTool('123', 'success', false);
});

// --- Case 7: Tool lifecycle (finalize - error) ---
show('tool lifecycle (finalize - error)', (t) => {
  t.startTool('123', 'reading_file', 'reading file');
  t.finalizeTool('123', 'error', true);
});

// --- Case 8: Error block ---
show('Error block', (t) => {
  t.appendError('unable to read file', false);
  t.appendError('unable to read file', true);
});

// --- Case 9: Mixed conversation ---
show('Mixed conversation', (t) => {
  t.appendUser('Hey Cog. How are you doing today?');
  t.appendAssistantDelta("The user is asking me how i'm Doing today.");
  t.appendAssistantDelta('I need to respond');
  t.startTool('123', 'read_file', 'Reading file');
  t.finalizeTool('123', 'read_file', false);
  t.appendAssistantDelta(
    'For some reason I attempted to just read a file when I should have responded',
  );
  t.appendError('Failure reading file', true);
});
