export type KeyEvent =
  | {
      type: "char";
      value: string;
    }
  | {
      type: "enter";
    }
  | {
      type: "esc";
    }
  | {
      type: "ctrl-c";
    }
  | {
      type: "backspace";
    }
  | {
      type: "arrow";
      dir: "up" | "down" | "left" | "right";
    };

/**
   * Parses a raw stdin buffer into discrete key events.
   *
   * In raw mode, `process.stdin` delivers each keypress as a Buffer.
   * A single buffer may contain multiple keypresses (e.g. pasted
  text),
   * so the return is always an array.
   *
   * Recognized byte sequences:
   *
   *   0x03                → ctrl-c
   *   0x0d                → enter
   *   0x7f                → backspace
   *   0x1b 0x5b 0x41      → arrow up    (CSI A)
   *   0x1b 0x5b 0x42      → arrow down  (CSI B)
   *   0x1b 0x5b 0x43      → arrow right (CSI C)
   *   0x1b 0x5b 0x44      → arrow left  (CSI D)
   *   0x1b (alone)         → esc
   *   0x20–0x7f            → printable ASCII char (1 byte)
   *   0xc0–0xdf leading    → printable UTF-8 char (2 bytes)
   *   0xe0–0xef leading    → printable UTF-8 char (3 bytes)
   *   0xf0–0xf7 leading    → printable UTF-8 char (4 bytes)
   *
   * Unrecognized control bytes (0x01–0x1a excluding 0x03, 0x0d) are
  skipped.
   */
export function parseInput(chunk: Buffer): KeyEvent[] {
  const events: KeyEvent[] = [];
  let i = 0;

  while (i < chunk.length) {
    const byte = chunk[i]!;

    if (byte === 0x03) {
      events.push({ type: "ctrl-c" });
      i++;
    } else if (byte === 0x0d) {
      events.push({ type: "enter" });
      i++;
    } else if (byte === 0x7f) {
      events.push({ type: "backspace" });
      i++;
    } else if (byte === 0x1b) {
      if (chunk[i + 1] === 0x5b) {
        const arrow = chunk[i + 2];
        if (arrow === 0x41) {
          events.push({ type: "arrow", dir: "up" });
          i += 3;
        } else if (arrow === 0x42) {
          events.push({ type: "arrow", dir: "down" });
          i += 3;
        } else if (arrow === 0x43) {
          events.push({ type: "arrow", dir: "right" });
          i += 3;
        } else if (arrow === 0x44) {
          events.push({ type: "arrow", dir: "left" });
          i += 3;
        } else {
          events.push({ type: "esc" });
          i++;
        }
      } else {
        events.push({ type: "esc" });
        i++;
      }
    } else if (byte >= 0x20) {
      const len = byte < 0x80 ? 1 : byte < 0xe0 ? 2 : byte < 0xf0 ? 3 : 4;
      const value = chunk.toString("utf8", i, i + len);
      events.push({ type: "char", value });
      i += len;
    } else {
      i++;
    }
  }

  return events;
}
