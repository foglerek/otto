export function parseOttoArgs(argv: string[]): {
  command: string;
  args: string[];
  helpRequested: boolean;
} {
  if (argv.length === 0) {
    return { command: "root", args: [], helpRequested: false };
  }

  if (argv[0] === "help") {
    return { command: "help", args: argv.slice(1), helpRequested: true };
  }

  const helpRequested = argv.includes("--help") || argv.includes("-h");
  if (argv[0].startsWith("-")) {
    return { command: "help", args: argv.slice(1), helpRequested: true };
  }

  const [command, ...args] = argv;
  return { command, args, helpRequested };
}
