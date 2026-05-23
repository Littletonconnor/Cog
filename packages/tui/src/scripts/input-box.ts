import { InputBox } from "../components/input-box.js";
import type { KeyEvent } from "../keys.js";
import { theme } from "../theme/default.js";

const WIDTH = 60;

function renderAndPrint(label: string, box: InputBox) {
  console.log(`--- ${label} ---`);
  console.log(`|${"-".repeat(WIDTH)}|`);
  for (const line of box.render(WIDTH, theme)) {
    console.log(`|${line}|`);
  }
  console.log(`|${"-".repeat(WIDTH)}|`);
  console.log();
}

function feed(box: InputBox, events: KeyEvent[], label: string) {
  console.log(`=== ${label} ===`);
  renderAndPrint("initial", box);
  let i = 1;
  for (const event of events) {
    box.handleKey(event);
    renderAndPrint(`after event ${i}: ${JSON.stringify(event)}`, box);
    i++;
  }
}

// --- Case 1: empty box ---
feed(new InputBox(), [], "empty box");

// --- Case 2: typing "hello" ---
feed(
  new InputBox(),
  [
    { type: "char", value: "h" },
    { type: "char", value: "e" },
    { type: "char", value: "l" },
    { type: "char", value: "l" },
    { type: "char", value: "o" },
  ],
  'typing "hello"',
);

// --- Case 3: backspace at end (hello -> hel) ---
feed(
  new InputBox(),
  [
    { type: "char", value: "h" },
    { type: "char", value: "e" },
    { type: "char", value: "l" },
    { type: "char", value: "l" },
    { type: "char", value: "o" },
    { type: "backspace" },
    { type: "backspace" },
  ],
  "backspace at end",
);

// --- Case 4: backspace at empty (should be a no-op) ---
feed(
  new InputBox(),
  [{ type: "backspace" }],
  "backspace at empty",
);

// --- Case 5: cursor in middle, insert X (hello -> helXlo) ---
feed(
  new InputBox(),
  [
    { type: "char", value: "h" },
    { type: "char", value: "e" },
    { type: "char", value: "l" },
    { type: "char", value: "l" },
    { type: "char", value: "o" },
    { type: "arrow", dir: "left" },
    { type: "arrow", dir: "left" },
    { type: "char", value: "X" },
  ],
  "cursor in middle, insert X",
);

// --- Case 6: arrow boundaries (clamp at start and end) ---
feed(
  new InputBox(),
  [
    { type: "arrow", dir: "left" },   // no-op at cursorPos 0
    { type: "char", value: "h" },
    { type: "char", value: "i" },
    { type: "arrow", dir: "right" },  // no-op at end
    { type: "arrow", dir: "right" },  // still no-op
  ],
  "arrow boundaries",
);

// --- Case 7: long buffer overflow (visual wrap — M4 will fix with horizontal scroll) ---
{
  const long =
    "the quick brown fox jumps over the lazy dog! " + "0123456789".repeat(6);
  const events: KeyEvent[] = [];
  for (const ch of long) {
    events.push({ type: "char", value: ch });
  }
  feed(new InputBox(), events, "long buffer (visual wrap expected)");
}
