export type FgRole = 'default' | 'dim' | 'accent' | 'success' | 'danger' | 'warning';

export type BgRole = 'user-bg';

export interface Theme {
  fg: (role: FgRole) => string;
  bg: (role: BgRole) => string;
  reset: () => string;
  bold: () => string;
  italic: () => string;
  dim: () => string;
}
