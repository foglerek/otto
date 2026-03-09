import { parseOttoArgs } from "./cli/parse.js";
import { resolveCommandHandler } from "./cli/commands/index.js";
import {
  fail,
  getCliVersion,
  output,
  printHelp,
  printNonInteractiveSnippet,
  resetJsonOutputMode,
  setJsonOutputMode,
} from "./cli/output.js";

export { parseOttoArgs } from "./cli/parse.js";
export { resolveCommandHandler } from "./cli/commands/index.js";
export { getCliVersion } from "./cli/output.js";
export { loadOttoConfig } from "./cli/config.js";

export async function runOttoCLI(argv: string[]): Promise<void> {
  setJsonOutputMode(argv.includes("--json"));
  try {
    const versionRequested = argv.includes("--version") || argv.includes("-v");
    const filteredArgv = argv.filter(
      (arg) => arg !== "--json" && arg !== "--version" && arg !== "-v",
    );

    if (versionRequested && filteredArgv.length === 0) {
      const version = await getCliVersion();
      output({ version }, [version]);
      return;
    }

    const { command, args, helpRequested } = parseOttoArgs(filteredArgv);
    if (helpRequested || command === "help") {
      printHelp();
      return;
    }

    const handler = resolveCommandHandler(command);
    if (!handler) {
      fail(`Unknown command: ${command}`);
      printHelp();
      return;
    }

    await handler(args);
  } catch (error) {
    if (error instanceof Error && error.name === "PromptUnavailableError") {
      printNonInteractiveSnippet();
      process.exitCode = 1;
      return;
    }
    const message = error instanceof Error ? error.message : String(error);
    fail(message);
  } finally {
    resetJsonOutputMode();
  }
}
