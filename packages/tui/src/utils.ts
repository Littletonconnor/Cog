/**
 * Char-wrap a string into rows of at most `width` characters. Returns
 * `[""]` for an empty string so callers can always render at least
 * one line. Local copy of `transcript.ts`'s helper; the eventual
 * extraction to a shared util is filed under TODO Follow-ups.
 */
function wrapText(text: string, width: number) {
  if (text === '') return [''];
  const lines: string[] = [];
  for (let i = 0; i < text.length; i += width) {
    lines.push(text.slice(i, i + width));
  }
  return lines;
}

export { wrapText };
