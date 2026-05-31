import { PermissionPrompt } from '../components/permission-prompt.js';
import { theme } from '../theme/default.js';

const WIDTH = 80;

function renderAndPrint(label: string, prompt: PermissionPrompt) {
  console.log(`--- ${label} ---`);
  console.log(`|${'-'.repeat(WIDTH)}|`);
  for (const line of prompt.render(WIDTH, theme)) {
    console.log(line);
  }
  console.log(`|${'-'.repeat(WIDTH)}|`);
  console.log();
}

async function show(label: string, setup?: (prompt: PermissionPrompt) => void) {
  const prompt = new PermissionPrompt();
  const promise = prompt.show({
    prompt: 'Run git log --oneline',
    patterns: [],
  });
  setup?.(prompt);
  renderAndPrint(label, prompt);
  const choice = await promise;
  console.log(`→ resolved with "${choice}"`);
}

show('Initial active render');

show('Arrow down twice', (p) => {
  p.handleKey({ type: 'arrow', dir: 'down' });
  p.handleKey({ type: 'arrow', dir: 'down' });
});

show('Arrow up clamps at 0', (p) => {
  p.handleKey({ type: 'arrow', dir: 'up' });
});

show('Arrow down clamps at last', (p) => {
  Array.from({ length: 10 }, () => {
    p.handleKey({ type: 'arrow', dir: 'down' });
    return 1;
  });
});

show('Tab = arrow down', (p) => {
  p.handleKey({ type: 'tab', dir: 'forward' });
});

show('Shift Tab = arrow up', (p) => {
  p.handleKey({ type: 'tab', dir: 'back' });
});

await show("Enter on 'Yes'", (p) => {
  p.handleKey({ type: 'enter' });
});

await show("Enter on 'Yes, don't ask again'", (p) => {
  p.handleKey({ type: 'arrow', dir: 'down' });
  p.handleKey({ type: 'enter' });
});

await show("Enter on 'No'", (p) => {
  p.handleKey({ type: 'arrow', dir: 'down' });
  p.handleKey({ type: 'arrow', dir: 'down' });
  p.handleKey({ type: 'enter' });
});

await show("Enter on 'Type something'", (p) => {
  p.handleKey({ type: 'arrow', dir: 'down' });
  p.handleKey({ type: 'arrow', dir: 'down' });
  p.handleKey({ type: 'arrow', dir: 'down' });
  p.handleKey({ type: 'enter' });
});
