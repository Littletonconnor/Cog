import type { BgRole, FgRole, Theme } from './index.js';

const theme = {
  fg: (role: FgRole) => {
    switch (role) {
      case 'default':
        return '';
      case 'dim':
        return '\x1b[2m';
      case 'accent':
        return '\x1b[36m';
      case 'success':
        return '\x1b[32m';
      case 'danger':
        return '\x1b[31m';
      case 'warning':
        return '\x1b[33m';
      default: {
        const _exhaustive: never = role;
        return _exhaustive;
      }
    }
  },
  bg: (role: BgRole) => {
    switch (role) {
      case 'user-bg':
        return '\x1b[100m';

      default: {
        const _exhaustive: never = role;
        return _exhaustive;
      }
    }
  },
  reset: () => {
    return '\x1b[0m';
  },
  bold: () => {
    return '\x1b[1m';
  },
  italic: () => {
    return '\x1b[3m';
  },
} satisfies Theme;

export { theme };
