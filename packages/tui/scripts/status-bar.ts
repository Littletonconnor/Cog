import { StatusBar } from '../components/status-bar.js';
import { theme } from '../theme/default.js';

const cases = [
  {
    width: 80,
    cwd: '~/projects/cog',
    model: 'haiku-4-5',
    thinking: false,
    label: 'happy_path',
  },
  {
    width: 80,
    cwd: '~/projects/cog',
    model: 'haiku-4-5',
    thinking: true,
    label: 'happy_path_on',
  },
  {
    width: 60,
    cwd: '~/projects/cog',
    model: 'haiku-4-5',
    thinking: false,
    label: 'narrow_should_drop_thinking_suffix',
  },
  {
    width: 40,
    cwd: '~/projects/cog',
    model: 'haiku-4-5',
    thinking: false,
    label: 'very_narrow_should_drop_thinking_suffix',
  },
  {
    width: 80,
    cwd: '~/development/personal/very/deep/path/cog',
    model: 'haiku-4-5',
    thinking: false,
    label: 'long_cwd',
  },
];

for (const c of cases) {
  const bar = new StatusBar(c.cwd, c.model, 90_000, 89_000, 'auto', c.thinking);

  console.log(`=== ${c.label} (width=${c.width}) ===`);
  console.log(`|${'-'.repeat(c.width)}|`);
  for (const line of bar.render(c.width, theme)) {
    console.log(`|${line}|`);
  }
  console.log(`|${'-'.repeat(c.width)}|`);
  console.log();
}
