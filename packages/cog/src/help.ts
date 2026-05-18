export function printHelpMessage() {
  const message = `Usage: cog [OPTIONS]

Options:
  -h, --help                   Show this help menu
  -m, --mock <path>            Replay a scripted JSON scenario (mock provider)
`;
  console.log(message);
}
