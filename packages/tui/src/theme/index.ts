type FgRole = 'default' | 'dim' | 'accent' | 'success' | 'danger' | 'warning';

type BgRole = 'user-bg';

interface Theme {
  fg: (role: FgRole) => string;
  bg: (role: BgRole) => string;
  reset: () => string;
  bold: () => string;
  italic: () => string;
}

export type { BgRole, FgRole, Theme };
