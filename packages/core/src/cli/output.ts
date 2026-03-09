import fs from "node:fs/promises";
import process from "node:process";

const NON_INTERACTIVE_COMMANDS = [
  "otto create",
  "otto ingest",
  "otto start",
  "otto resume",
  "otto active",
  "otto delete",
  "otto onboarding",
  "otto config",
];

const NO_RUNNER_MESSAGE =
  "Error, need to configure at least one runner. See README";

let jsonOutputMode = false;
let cachedCliVersion: string | null = null;

export class PromptUnavailableError extends Error {
  constructor(message?: string) {
    super(message ?? "Prompt UI unavailable (no TTY). Use non-interactive commands.");
    this.name = "PromptUnavailableError";
  }
}

export function setJsonOutputMode(value: boolean): void {
  jsonOutputMode = value;
}

export function resetJsonOutputMode(): void {
  jsonOutputMode = false;
}

export function isJsonOutputMode(): boolean {
  return jsonOutputMode;
}

export function printHelp(): void {
  if (jsonOutputMode) {
    process.stdout.write(
      `${JSON.stringify({
        name: "otto",
        commands: [
          { name: "create", usage: "otto create <ticket-prompt>" },
          { name: "ingest", usage: "otto ingest <path>" },
          { name: "start", usage: "otto start <ticket>" },
          { name: "resume", usage: "otto resume [ticket|state]" },
          { name: "active", usage: "otto active" },
          { name: "delete", usage: "otto delete [ticket|state]" },
          { name: "onboarding", usage: "otto onboarding" },
          { name: "config", usage: "otto config" },
        ],
      })}\n`,
    );
    return;
  }

  process.stdout.write(
    [
      "otto",
      "",
      "Usage:",
      "  otto <command> [args]",
      "",
      "Commands:",
      "  create <ticket-prompt>   create a managed ticket",
      "  ingest <path>            ingest an external ticket file",
      "  start <ticket>           start a run",
      "  resume [ticket|state]    resume a run",
      "  active                   list active runs",
      "  delete [ticket|state]    delete a run",
      "  onboarding               run onboarding checks and guidance",
      "  config                   show repo config",
      "",
      "Notes:",
      "  Run without args to launch the start screen (TTY only).",
      "",
    ].join("\n"),
  );
}

export function printNonInteractiveSnippet(): void {
  if (jsonOutputMode) {
    process.stderr.write(
      `${JSON.stringify({
        error: "Interactive prompt unavailable",
        nonInteractiveCommands: NON_INTERACTIVE_COMMANDS,
      })}\n`,
    );
    return;
  }

  process.stderr.write(
    [
      "Non-interactive commands:",
      ...NON_INTERACTIVE_COMMANDS.map((cmd) => `  ${cmd}`),
      "",
    ].join("\n"),
  );
}

export function fail(message: string): void {
  if (jsonOutputMode) {
    process.stderr.write(`${JSON.stringify({ error: message })}\n`);
  } else {
    process.stderr.write(`${message}\n`);
  }
  process.exitCode = 1;
}

export function failNoRunner(): void {
  fail(NO_RUNNER_MESSAGE);
}

export function output(data: unknown, textLines: string[]): void {
  if (jsonOutputMode) {
    process.stdout.write(`${JSON.stringify(data)}\n`);
    return;
  }
  process.stdout.write(textLines.join("\n"));
}

export async function getCliVersion(): Promise<string> {
  if (cachedCliVersion) return cachedCliVersion;
  const pkgPath = new URL("../../package.json", import.meta.url);
  const raw = await fs.readFile(pkgPath, "utf8");
  const parsed = JSON.parse(raw) as { version?: string };
  cachedCliVersion = parsed.version ?? "0.0.0";
  return cachedCliVersion;
}
