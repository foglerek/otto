import path from "node:path";
import process from "node:process";
import { pathToFileURL } from "node:url";

import { createJiti } from "jiti";
import type { OttoConfig } from "@otto/config";
import { createOpentuiPromptAdapter } from "@otto/ui-opentui";

import { runBootstrap } from "./bootstrap.js";
import { runOttoCleanup } from "./cleanup.js";
import { runOttoRun } from "./run.js";
import { loadOttoState, resolveConfigPathFromState } from "./state.js";

function hasFlag(argv: string[], flag: string): boolean {
  return argv.includes(flag);
}

function getFlagValue(argv: string[], flag: string): string | undefined {
  const idx = argv.indexOf(flag);
  if (idx < 0) return undefined;
  return argv[idx + 1];
}

function parseCommand(argv: string[]): { command: string; rest: string[] } {
  const flagsWithValues = new Set([
    "--config",
    "--slug",
    "--date",
    "--ask",
    "--state",
  ]);
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (flagsWithValues.has(a)) {
      i += 1;
      continue;
    }
    if (a.startsWith("-")) continue;
    const rest = [...argv.slice(0, i), ...argv.slice(i + 1)];
    return { command: a, rest };
  }
  return { command: "help", rest: argv };
}

function printHelp(): void {
  process.stdout.write(
    [
      "otto (scaffold)",
      "",
      "Usage:",
      "  otto <command> [options]",
      "",
      "Commands:",
      "  bootstrap   create .otto + worktree + run repo hook",
      "  run         create a run plan file from state",
      "  cleanup     remove worktree and optionally delete artifacts",
      "",
      "Options:",
      "  --config <path>     path to otto.config.ts",
      "  --state <path>      path to .otto/states/run-*.json",
      "  --slug <slug>       ask slug (default: bootstrap)",
      "  --date <YYYY-MM-DD> ask date (default: today)",
      "  --ask <text>        ask description text",
      "  --force             do not prompt for confirmation",
      "  --delete-branch     delete the worktree branch during cleanup",
      "  --delete-artifacts  delete .otto/runs/<runId> during cleanup",
      "  -h, --help          show help",
      "",
      "Notes:",
      "  This is scaffolding. The full workflow engine is not implemented yet.",
      "",
    ].join("\n"),
  );
}

export async function loadOttoConfig(configPath?: string): Promise<OttoConfig> {
  const resolved = path.resolve(configPath ?? "otto.config.ts");

  const jiti = createJiti(import.meta.url, {
    interopDefault: true,
  });

  const mod = await jiti(pathToFileURL(resolved).href);
  const cfg = (mod?.default ?? mod) as OttoConfig;

  if (!cfg || typeof cfg !== "object") {
    throw new Error(`Invalid otto config at ${resolved}`);
  }

  return cfg;
}

type CommandHandler = (rest: string[]) => Promise<void>;

async function handleBootstrapCommand(rest: string[]): Promise<void> {
  const configPath = getFlagValue(rest, "--config");
  const config = await loadOttoConfig(configPath);

  if (!config.worktree?.adapter) {
    throw new Error("otto config must provide worktree.adapter");
  }
  if (!config.runners?.default) {
    throw new Error("otto config must provide runners.default");
  }

  const slug = getFlagValue(rest, "--slug");
  const date = getFlagValue(rest, "--date");
  const askText = getFlagValue(rest, "--ask");

  const result = await runBootstrap({
    cwd: process.cwd(),
    config,
    configPath,
    slug,
    date,
    askText,
  });

  process.stdout.write(
    [
      "Bootstrapped Otto run.",
      `- Artifact root: ${result.artifactRootDir}`,
      `- Ask: ${result.askFilePath}`,
      `- Worktree: ${result.worktreePath}`,
      `- Branch: ${result.branchName}`,
      `- State: ${result.stateFile}`,
      "",
    ].join("\n"),
  );
}

async function handleRunCommand(rest: string[]): Promise<void> {
  const statePath = getFlagValue(rest, "--state");
  if (!statePath) {
    throw new Error("otto run requires --state <path>");
  }
  const state = await loadOttoState(statePath);

  const configPathOverride = getFlagValue(rest, "--config");
  const resolvedConfigPath = resolveConfigPathFromState({
    state,
    overridePath: configPathOverride,
  });

  const config = await loadOttoConfig(resolvedConfigPath);
  if (!config.worktree?.adapter) {
    throw new Error("otto config must provide worktree.adapter");
  }
  if (!config.runners?.default) {
    throw new Error("otto config must provide runners.default");
  }

  const prompt = config.prompt?.adapter ?? createOpentuiPromptAdapter();
  if (!prompt) {
    throw new Error("otto requires a prompt adapter");
  }

  const { planFilePath, stoppedAtPhase } = await runOttoRun({
    state,
    stateFilePath: statePath,
    config,
    prompt,
  });
  process.stdout.write(
    [
      "Workflow progressed.",
      `- State: ${path.resolve(statePath)}`,
      `- Plan: ${planFilePath}`,
      `- Phase: ${stoppedAtPhase}`,
      "",
    ].join("\n"),
  );
}

async function handleCleanupCommand(rest: string[]): Promise<void> {
  const statePath = getFlagValue(rest, "--state");
  if (!statePath) {
    throw new Error("otto cleanup requires --state <path>");
  }
  const state = await loadOttoState(statePath);

  const configPathOverride = getFlagValue(rest, "--config");
  const resolvedConfigPath = resolveConfigPathFromState({
    state,
    overridePath: configPathOverride,
  });

  const config = await loadOttoConfig(resolvedConfigPath);
  const prompt = config.prompt?.adapter ?? createOpentuiPromptAdapter();
  if (!prompt) {
    throw new Error("otto requires a prompt adapter");
  }

  const force = hasFlag(rest, "--force");
  const deleteBranch = hasFlag(rest, "--delete-branch");
  const deleteArtifacts = hasFlag(rest, "--delete-artifacts");

  await runOttoCleanup({
    state,
    config,
    prompt,
    force,
    deleteBranch,
    deleteArtifacts,
  });

  process.stdout.write(
    ["Cleanup complete.", `- State: ${path.resolve(statePath)}`, ""].join("\n"),
  );
}

const commandHandlers: Record<string, CommandHandler> = {
  bootstrap: handleBootstrapCommand,
  run: handleRunCommand,
  cleanup: handleCleanupCommand,
};

export async function runOttoCLI(argv: string[]): Promise<void> {
  const helpRequested = argv.includes("--help") || argv.includes("-h");
  const { command, rest } = parseCommand(argv);

  if (helpRequested || command === "help") {
    printHelp();
    return;
  }

  const handler = commandHandlers[command];
  if (!handler) {
    throw new Error(`Unknown command: ${command}`);
  }

  await handler(rest);
}
