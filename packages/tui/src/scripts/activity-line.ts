import { setTimeout as sleep } from "node:timers/promises";
import { ActivityLine } from "../components/activity-line.js";
import { theme } from "../theme/default.js";

const WIDTH = 60;
console.log("Case 1: === IDLE ===");
{
  const line = new ActivityLine(null);

  for (const l of line.render(WIDTH, theme)) {
    console.log(l);
  }
}

console.log("Case 2: === THINKING 10 frames at 80ms apart ===");
{
  const line = new ActivityLine("thinking");

  for (let i = 0; i <= 10; i++) {
    const l = line.render(WIDTH, theme)[0];
    process.stdout.write(`\r${l}`);
    await sleep(80);
  }
}

console.log("Case 3: === tool call ===");
{
  const line = new ActivityLine("read_file");

  for (let i = 0; i <= 10; i++) {
    const l = line.render(WIDTH, theme)[0];
    process.stdout.write(`\r${l}`);
    await sleep(80);
  }
}
