import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { pathToFileURL } from "node:url";

import { createJiti } from "jiti";
import type { OttoConfig } from "@otto/config";
import type { OttoPromptAdapter, OttoRunner } from "@otto/ports";

import { createNodeExec } from "./exec.js";
import { ensureRepoSetup } from "./repo-setup.js";
import { isRunLockStale, readRunLockFile, writeRunLockFile } from "./locks/run-lock.js";
import { killOttoProcess } from "./runs/kill.js";
import { listRuns } from "./runs/listing.js";
import { getStateFilePathForRunId } from "./runs/paths.js";
import { buildInitialRunState } from "./runs/state.js";
import { runOttoCleanup } from "./cleanup.js";
import { runOttoRun } from "./run.js";
import { createOttoStateStore } from "./workflow/state-store.js";
import { loadOttoState } from "./state.js";
import { listManagedTicketIds } from "./tickets/list.js";
import { getTicketFilePathForId } from "./tickets/paths.js";
import {
  createTicketFromLeadOutput,
  ingestTicketFromLeadOutput,
  amendTicketFromLeadOutput,
} from "./tickets/operations.js";
import { runProjectLeadWithSession } from "./tickets/project-lead.js";
import {
  buildTicketCreatePrompt,
  buildTicketAmendPrompt,
  buildTicketIngestPrompt,
  buildTicketRetryPrompt,
} from "./tickets/prompts.js";

const LOGO = `                 ▗▄▞▞▟                                                                              
           ▄▄▟▐▀▛▚▖▞▞▀▜▜▖                                                                           
        ▄▀▀▖▄▗▚▐▐▗▚▚▚▀▌▚▀▀▜▄                                                                        
   ▖▄▖▄▛▚▀▞▞▞▞▞▞▐▐▐▝▞▞▞▞▞▜▗▐▜▄                                                                      
 ▗▛▚▖▌▛▞▞▞▛▀▌▌▞▞▞▞▖▌▌▌▚▚▚▀▜▄▚▐▀▜▐▄                                                                  
 █▞█▟▞▞▞▞▞▞▚▚▚▚▘▌▞▞▞▞▐▐▗▚▀▞▐▐▐▐▐▄▞▙                                                                 
 █▟▟█▟▐▝▞▟▟█▙▞▖▌▌▌▚▐▐▐▐▐▐▟▟▟▐▐▝▛█▚▜▖                                                                
 ▟▜ ▚▞▙▚▚██▙▄█▞▞▞▐▝▞▝▝▞▄█▗▟█▙▚▚▜▛▙▛                                                                 
▗█▐▗▚█▟▚▀█████▘▘▟█▛▛▛█▙▝█████▐▐▗▜▙                        ▗▛▀▀▀▜▄     ▗▟▀▀▀▜▄▖                      
 █▟▟▟▙█▄▖▘▀▀▀▚  ▜█████▛ ▝▀▛▛ ▗▖▖▞▙▖▖▖                    ▐▛  ▝▝▖▛▌   ▐▛  ▝▝▖▞▙                      
 ▜▟▟▙▛▙    ▖▝▝▖   ▗▟▖  ▝▗▀    ▖▄▄█        ▗▖▄▄▄▄▗▖      ▗▟▌▚▘▌▚▗▜▙▖▖▗▟▌▘▌▚▚▗▝▙▄▖     ▗▗▄▄▄▄▗▖▖      
  ▝▜▞▞▛▟██▛▜▄ ▝▜██▛████▀▘   ▖▘ ▖▄▛▀    ▄▞▛▘    ▗▗▝▀▙▖ ▗▛▀  ▗▘▞▗▘▖▖▝█▀  ▘▝▖▖▘▚▗▗▀█ ▗▄▀▀    ▗▗▝▝▙▄    
   ▝▜█▐▄ ▀▜█▚ ▗ ▝▌▌▌▞▞▘   ▝  ▖▞▄▛    ▗▟▝▗   ▖▘▚▘▖▞▗ ▀▙▜▌▚▘▚▗▘▞▗▘▞▗▘█▚▘▌▞▝▖▞▐▗▘▖▞▟▙▌▚▝  ▗▝▝▖▖▞▖▖▝▛▖  
     ▝█▟█▙▘▖▗▗     ▘ ▗▄▄▟▟▀▄▀█▀▘    ▗▚▌▘ ▗▘▚▝▟▄▞▗▝▖▘▚▝▛█▄▙▚▖▚▝▖▚▟▄▛█▚▙▄▞▝▖▞▖▄▙▟▟▜▟▝ ▗▝▝▖▙▙▖▚▗▗▝▖▞▜▖ 
      █▚▛▞▛▝▝▗▝▞▝▝▝▐▞▟▚▘▜▗▗▖▞▀▚▄▄   ▐▜▗▚▘▚▝▖█▚▛▟▌▚▝▐ ▚▐▙▀█▚▝▖▚▝▞█▀▘▝▀▜▌▞▐▗▗▝█▛▀▚▛▚▝▞▗▘▌▛▟▞█▞▖▘▚▗▝▞▛ 
     ▐▛▙▜▐▐▗   ▝▝▝▝ ▐▛▌▗ ▗ ▝▘▘▀▚▚▌  ▛▌▚▗▘▚▝▞▛▘ ▐▜▗▘▘▚▘▌█▗█▐▝▐▗▚▐▛▌   █▌▌▚▝▝▞▙▌ ▗█▘▚▝▖▚▐▜▘ ▐▚▞▐▗▘▚▝▛▌
    ▗█▛▟▐▐▐▗▀▄▌▖ ▖▄▄▙▛▞ ▀  ▗▗  ▙▜▘  █▜▗▘▚▘▚▝█▖ ▄▛▗▘▌▚▐▐▟▐▙▚▘▚▗▘▞█▘   █▚▐▗▚▚▗▜▙ ▐█▐▗▚▝▖▚█▖ ▐▜ ▚▗▘▌▌█▖
    █▙▛▙▜▞▞▞▞▄▐▝▀▌▙▜▞█ ▄▞     █▜▜▜▖ ▐█▐▐▗▚▘▚▝▜▜▞▗▗▚▐▗▚▜▙▐▙▚▚▘▚▝▝▟█▜▄▞█▌▌▄▗▘▖▀▛▛▛█▞▞▖▚▐▗▝▟▛▛▗▐▝▖▚▐▐█ 
   ▟▌▌▛▟▙▜▞▙▜▐▐▞▛▞▙▙█▛  ▗ ▝▝▘▐█▞▙▜▌ ▝▛▙▚▚▗▚▚▗▗▖▖▚▚▝▖▌▙█▞▝▟▌▌▞▖▌▌▖▖▚▝█▙█▝▖▘▚▘▚▝▖▞▟█▞▞▐▗▖▚ ▖▖▚▝▞▐▐▐█▞ 
  ▐█▐▜▐▞▟▜▟▙▙█▟▞▟▜▟▟▙▌▘▀▘  ▖ ▐▙▛▟█▘  ▝██▞▞▄▝▞▖▞▐▗▄▚▚▛▙▌  ▜█▞▞▖▚▝▖▚▚▜▙▚█▙▚▀▖▌▚▚▐▗█▟▜▞▙▄▐▗▚▚▐▝▞▞▞▟▛▌  
  █▌▙▜▞▟▟▜▜▝▖▞▘██▀▀▜▟▞▙▚▄▄▖▗ ▞▟██▄▄    ▚██▟▙▌▙▜▐▟▟▟█▀▘    ▝█▙█▟▟▟▟▟▛▝ ▝▟█▟▟▟▟▄▙█▘ ▀▜▙▙▙▙▌▙▙█▟▟█▀▘▗▟▌
 ▗█▞▟▞▟▞▞▞▞▞▞▖▙▗▐▜▖▖ ▀▀▀▚▙█▙▛▛▟▞▖▛███▜▀▜▗▙█▟███▛▀▝▘         ▝▝▘▀▞▀▝     ▝▝▀▝▘▀▘      ▀▀▘▛▀▞▘▀▘▗▄█▜▛ 
  ██▞▟▞▟▞▌▙▚▚▚▚▚▙▛▛▀█▄      ▀█▜▟▛▙▙▚▞█▛▞▞▖▖▖▗ ▖▀▀▀▀▀▀▜▞▄▄▄▄▄▄▄▖▖                        ▖▄▄▟▟▜▜▚▙█▘ 
  █▙▜▚▜▞▟▞▟▐▚▚█▜▄█▟█▟▟▙ ▘ ▝ ▙██▚▙█▜██▞▛█▟▐▚▜▐▐▐▞▌▌▌▛▞▖▞▗▄▗▝ ▚▝▞▀▀▀▀▀▀▜▀▌▙▙▙▚▙▙▚▙▜▜▜▀▛▀▀▀▀▜▐▄▚▛▟█▀   
  ▝█▙▛▙▜▟▐▙▜▞▙█▟▟▛█▜▜▙▌▗▘▝▞▐▛█▙████▟▜▛█▛▟▜▟▚▛▙▌▌▙▙▚▚▚▚▚▚▐▐▐▀▖▌▞▞▞▞▞▞▞▄▄▐▗▗▗▚▗▗▚▗▚▖▌▙▐▀▛▛▛▙▙▙█▛▀     
   ▝▜▟▜▜▟▜▟▙▛██▟▜███▜▛▐▗▝▟▄███▟▜██▛▛██▛█▜█▟▜▜▟▟▜▚▙▜▚▙▙▚▜▟▐▞▟▚▙▚▌▙▚▌▙▚▚▞▞▞▟▐▞▞▌▙▙▙▜▟▐▙█▟██▜▀▀        
     ▀▛█▟█▟▟▜██▟███▜█▟▙▄██████▟█▜▟███▙███▟███▟▟██▟██▟▟▜▙▙█▟▙▛▟▙█▟▙█▟▜█▟▛█▟▙██▜▟▟▟█▟▛▀▀▘▘            
       ▖▘▀▀▜▜▜▜██▟█▜▀▀▀▀▘▘▖▝▝▀▛▜▀▀▘▀▝▀▘▀▝▀▝▀▀▀▀▀▀▀▀▀▀▀▛▀▛▀▛▀▛▛▜▀▀▜▐▀▛▀▀▀▀▀▀▘▘▀▝                     
                                                                ▘                                 `;

class PromptUnavailableError extends Error {
  constructor(message?: string) {
    super(message ?? "Prompt UI unavailable (no TTY). Use non-interactive commands.");
    this.name = "PromptUnavailableError";
  }
}

const NO_RUNNER_MESSAGE =
  "Error, need to configure at least one runner. See README";

const NON_INTERACTIVE_COMMANDS = [
  "otto create",
  "otto ingest",
  "otto start",
  "otto resume",
  "otto active",
  "otto delete",
  "otto config",
];

type OttoCommand =
  | "root"
  | "help"
  | "create"
  | "ingest"
  | "start"
  | "resume"
  | "active"
  | "delete"
  | "config";

type CommandHandler = (args: string[]) => Promise<void>;

async function pathExists(filePath: string): Promise<boolean> {
  try {
    await fs.stat(filePath);
    return true;
  } catch (error) {
    const err = error as NodeJS.ErrnoException;
    if (err.code === "ENOENT") return false;
    throw error;
  }
}

async function findNearestOttoConfigPath(startDir: string): Promise<string> {
  let dir = path.resolve(startDir);
  while (true) {
    const candidate = path.join(dir, "otto.config.ts");
    if (await pathExists(candidate)) {
      return candidate;
    }

    const parent = path.dirname(dir);
    if (parent === dir) {
      return path.join(path.resolve(startDir), "otto.config.ts");
    }
    dir = parent;
  }
}

async function loadConfigFromCwd(): Promise<{ config: OttoConfig; configPath: string }> {
  const configPath = await findNearestOttoConfigPath(process.cwd());
  const config = await loadOttoConfig(configPath);
  return { config, configPath };
}

export async function loadOttoConfig(configPath: string): Promise<OttoConfig> {
  const resolved = path.resolve(configPath);

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

function isCi(): boolean {
  const ci = process.env.CI;
  if (!ci) return false;
  return ci.toLowerCase() === "true" || ci === "1";
}

function hasTty(): boolean {
  return Boolean(process.stdin.isTTY && process.stdout.isTTY);
}

function isInteractiveAvailable(): boolean {
  return hasTty() && !isCi();
}

function printHelp(): void {
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
      "  start <ticket>           start a run (stub)",
      "  resume [ticket|state]    resume a run (stub)",
      "  active                   list active runs (stub)",
      "  delete [ticket|state]    delete a run (stub)",
      "  config                   show repo config",
      "",
      "Notes:",
      "  Run without args to launch the start screen (TTY only).",
      "",
    ].join("\n"),
  );
}

function printNonInteractiveSnippet(): void {
  process.stderr.write(
    [
      "Non-interactive commands:",
      ...NON_INTERACTIVE_COMMANDS.map((cmd) => `  ${cmd}`),
      "",
    ].join("\n"),
  );
}

function fail(message: string): void {
  process.stderr.write(`${message}\n`);
  process.exitCode = 1;
}

function failNoRunner(): void {
  fail(NO_RUNNER_MESSAGE);
}

function getProjectLeadRunner(config: OttoConfig): OttoRunner | null {
  return (
    config.runners?.byRole?.projectLead ??
    config.runners?.byRole?.lead ??
    config.runners?.default ??
    null
  );
}

function isRetryableTicketError(err: unknown): boolean {
  const message = err instanceof Error ? err.message : String(err);
  return (
    message.includes("missing <SLUG>") ||
    message.includes("missing <CONTENT>") ||
    message.includes("3-5 words") ||
    message.includes("could not be normalized")
  );
}

async function runProjectLeadPrompt(args: {
  runner: OttoRunner;
  repoPath: string;
  prompt: string;
  phaseName: string;
}): Promise<string> {
  const exec = createNodeExec();
  const result = await runProjectLeadWithSession({
    repoPath: args.repoPath,
    runner: args.runner,
    exec,
    prompt: args.prompt,
    cwd: args.repoPath,
    phaseName: args.phaseName,
  });

  if (!result.success) {
    throw new Error(result.error ?? "Project lead failed.");
  }

  return result.outputText ?? "";
}

async function runTicketCreate(args: {
  repoPath: string;
  runner: OttoRunner;
  ticketText: string;
}): Promise<{ ticketId: string; filePath: string }> {
  const basePrompt = buildTicketCreatePrompt({ ticketText: args.ticketText });
  const maxAttempts = 2;

  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    const prompt =
      attempt === 0
        ? basePrompt
        : buildTicketRetryPrompt({
            basePrompt,
            errorMessage: "Missing or invalid tags/slug.",
          });
    const outputText = await runProjectLeadPrompt({
      runner: args.runner,
      repoPath: args.repoPath,
      prompt,
      phaseName: "ticket-create",
    });

    try {
      const result = await createTicketFromLeadOutput({
        repoPath: args.repoPath,
        outputText,
      });
      return { ticketId: result.ticketId, filePath: result.filePath };
    } catch (error) {
      if (attempt + 1 >= maxAttempts || !isRetryableTicketError(error)) {
        throw error;
      }
    }
  }

  throw new Error("Ticket creation failed.");
}

async function runTicketIngest(args: {
  repoPath: string;
  runner: OttoRunner;
  sourceFilePath: string;
}): Promise<{ ticketId: string; filePath: string }> {
  const sourceContent = await fs.readFile(args.sourceFilePath, "utf8");
  const basePrompt = buildTicketIngestPrompt({ sourceContent });
  const maxAttempts = 2;

  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    const prompt =
      attempt === 0
        ? basePrompt
        : buildTicketRetryPrompt({
            basePrompt,
            errorMessage: "Missing or invalid slug.",
          });
    const outputText = await runProjectLeadPrompt({
      runner: args.runner,
      repoPath: args.repoPath,
      prompt,
      phaseName: "ticket-ingest",
    });

    try {
      const result = await ingestTicketFromLeadOutput({
        repoPath: args.repoPath,
        sourceFilePath: args.sourceFilePath,
        outputText,
      });
      return { ticketId: result.ticketId, filePath: result.filePath };
    } catch (error) {
      if (attempt + 1 >= maxAttempts || !isRetryableTicketError(error)) {
        throw error;
      }
    }
  }

  throw new Error("Ticket ingest failed.");
}

async function runTicketAmend(args: {
  repoPath: string;
  runner: OttoRunner;
  ticketId: string;
  amendInstructions: string;
}): Promise<{ ticketId: string; filePath: string }> {
  const existingContent = await fs.readFile(
    getTicketFilePathForId({ repoPath: args.repoPath, ticketId: args.ticketId }),
    "utf8",
  );
  const basePrompt = buildTicketAmendPrompt({
    ticketId: args.ticketId,
    existingContent,
    amendInstructions: args.amendInstructions,
  });
  const maxAttempts = 2;

  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    const prompt =
      attempt === 0
        ? basePrompt
        : buildTicketRetryPrompt({
            basePrompt,
            errorMessage: "Missing or invalid <CONTENT> tag.",
          });
    const outputText = await runProjectLeadPrompt({
      runner: args.runner,
      repoPath: args.repoPath,
      prompt,
      phaseName: "ticket-amend",
    });

    try {
      const result = await amendTicketFromLeadOutput({
        repoPath: args.repoPath,
        ticketId: args.ticketId,
        outputText,
      });
      return { ticketId: result.ticketId, filePath: result.filePath };
    } catch (error) {
      if (attempt + 1 >= maxAttempts || !isRetryableTicketError(error)) {
        throw error;
      }
    }
  }

  throw new Error("Ticket amend failed.");
}

async function handleCreateCommand(args: string[]): Promise<void> {
  const ticketText = args.join(" ").trim();
  if (!ticketText) {
    fail("otto create requires <ticket-prompt>");
    return;
  }

  const { config } = await loadConfigFromCwd();
  const runner = getProjectLeadRunner(config);
  if (!runner) {
    failNoRunner();
    return;
  }

  const repoPath = await config.worktree.adapter.getMainRepoPath(process.cwd());
  await ensureRepoSetup({ mainRepoPath: repoPath, config });
  const result = await runTicketCreate({
    repoPath,
    runner,
    ticketText,
  });

  process.stdout.write(
    ["Ticket created.", `- Id: ${result.ticketId}`, `- Path: ${result.filePath}`, ""].join(
      "\n",
    ),
  );
}

async function handleIngestCommand(args: string[]): Promise<void> {
  const sourceFilePath = args.join(" ").trim();
  if (!sourceFilePath) {
    fail("otto ingest requires <path-to-ticket>");
    return;
  }

  const { config } = await loadConfigFromCwd();
  const runner = getProjectLeadRunner(config);
  if (!runner) {
    failNoRunner();
    return;
  }

  const repoPath = await config.worktree.adapter.getMainRepoPath(process.cwd());
  await ensureRepoSetup({ mainRepoPath: repoPath, config });
  const result = await runTicketIngest({
    repoPath,
    runner,
    sourceFilePath,
  });

  process.stdout.write(
    ["Ticket ingested.", `- Id: ${result.ticketId}`, `- Path: ${result.filePath}`, ""].join(
      "\n",
    ),
  );
}

async function handleConfigCommand(): Promise<void> {
  const { config, configPath } = await loadConfigFromCwd();

  const runner = getProjectLeadRunner(config);
  if (!runner) {
    failNoRunner();
    return;
  }

  process.stdout.write(
    [
      "Otto config:",
      `- Path: ${configPath}`,
      `- Default runner: ${config.runners?.default?.id ?? "(unknown)"}`,
      "",
    ].join("\n"),
  );
}

function createHeadlessPromptAdapter(): OttoPromptAdapter {
  const fail = async () => {
    throw new PromptUnavailableError();
  };
  return {
    confirm: fail,
    text: fail,
    select: fail,
  };
}

async function getPromptAdapter(config: OttoConfig): Promise<OttoPromptAdapter> {
  if (config.prompt?.adapter) return config.prompt.adapter;
  if (!isInteractiveAvailable()) return createHeadlessPromptAdapter();

  const mod = await import("@otto/ui-opentui");
  return mod.createOpentuiPromptAdapter();
}

function parseTicketMetaFromId(ticketId: string): { date: string; slug: string } {
  const match = ticketId.match(/^(\d{4}-\d{2}-\d{2})-(.+)$/);
  if (!match) {
    throw new Error(`Invalid ticket id (expected YYYY-MM-DD-<slug>): ${ticketId}`);
  }
  return { date: match[1], slug: match[2] };
}

async function writeStateFile(state: object, stateFilePath: string): Promise<void> {
  const store = createOttoStateStore({ filePath: stateFilePath, initialState: state });
  await store.save();
}

async function acquireRunLock(args: {
  lockFilePath: string;
  runId: string;
  stateFilePath: string;
}): Promise<void> {
  const existing = await readRunLockFile(args.lockFilePath);
  if (existing) {
    const stale = await isRunLockStale({ lock: existing });
    if (!stale) {
      throw new Error(`Run is active (pid ${existing.pid}).`);
    }
    await fs.rm(args.lockFilePath, { force: true });
  }

  await writeRunLockFile(args.lockFilePath, {
    pid: process.pid,
    startedAt: new Date().toISOString(),
    runId: args.runId,
    stateFilePath: args.stateFilePath,
  });
}

async function releaseRunLock(lockFilePath: string): Promise<void> {
  await fs.rm(lockFilePath, { force: true });
}

async function handleStartCommand(args: string[]): Promise<void> {
  const ticketId = (args[0] ?? "").trim();
  if (!ticketId || args.length !== 1) {
    fail("otto start requires <ticket>");
    return;
  }

  const { config, configPath } = await loadConfigFromCwd();
  const runner = getProjectLeadRunner(config);
  if (!runner) {
    failNoRunner();
    return;
  }

  const mainRepoPath = await config.worktree.adapter.getMainRepoPath(process.cwd());
  const { artifactPaths } = await ensureRepoSetup({ mainRepoPath, config });

  const ticketFilePath = getTicketFilePathForId({ repoPath: mainRepoPath, ticketId });
  if (!(await pathExists(ticketFilePath))) {
    fail(`Ticket not found: ${ticketId}`);
    return;
  }

  const stateFilePath = getStateFilePathForRunId({
    artifactRootDir: artifactPaths.rootDir,
    runId: ticketId,
  });
  if (await pathExists(stateFilePath)) {
    fail(`Run already exists for ticket ${ticketId}. Use: otto resume ${ticketId}`);
    return;
  }

  const { date, slug } = parseTicketMetaFromId(ticketId);
  const branchName = config.worktree.branchNamer({
    ticket: { date, slug, filePath: ticketFilePath },
  });

  const baseBranch = config.worktree.baseBranch;
  const worktreePath = (
    await config.worktree.adapter.createWorktree({
      mainRepoPath,
      baseBranch,
      branchName,
      worktreesDir: config.worktree.worktreesDir,
    })
  ).worktreePath;

  const exec = createNodeExec();
  const envVars: Record<string, string> = {};
  const testEnvVars: Record<string, string> = {};

  await config.worktree.afterCreate({
    worktree: {
      mainRepoPath,
      worktreePath,
      branchName,
      baseBranch,
    },
    exec,
    env: {
      set: (key, value) => {
        envVars[key] = value;
      },
    },
    testEnv: {
      set: (key, value) => {
        testEnvVars[key] = value;
      },
    },
    services: {},
    logger: {
      info: (msg) => {
        process.stdout.write(`[info] ${msg}\n`);
      },
      warn: (msg) => {
        process.stderr.write(`[warn] ${msg}\n`);
      },
      error: (msg) => {
        process.stderr.write(`[error] ${msg}\n`);
      },
    },
  });

  const state = buildInitialRunState({
    mainRepoPath,
    artifactRootDir: artifactPaths.rootDir,
    configPath,
    ticketId,
    ticketFilePath,
    worktreePath,
    branchName,
    baseBranch,
    env: envVars,
    testEnv: testEnvVars,
  });

  await writeStateFile(state, state.stateFilePath);
  await acquireRunLock({
    lockFilePath: state.lockFilePath,
    runId: state.runId,
    stateFilePath: state.stateFilePath,
  });

  const prompt = await getPromptAdapter(config);
  try {
    const result = await runOttoRun({
      state,
      stateFilePath: state.stateFilePath,
      config,
      prompt,
    });
    process.stdout.write(
      [
        `Run stopped at phase: ${result.stoppedAtPhase}`,
        `Plan file: ${result.planFilePath}`,
        "",
      ].join("\n"),
    );
  } finally {
    await releaseRunLock(state.lockFilePath);
  }
}

async function handleResumeCommand(args: string[]): Promise<void> {
  const { config } = await loadConfigFromCwd();
  const runner = getProjectLeadRunner(config);
  if (!runner) {
    failNoRunner();
    return;
  }

  const mainRepoPath = await config.worktree.adapter.getMainRepoPath(process.cwd());
  const { artifactPaths } = await ensureRepoSetup({ mainRepoPath, config });

  const arg = (args[0] ?? "").trim();
  if (!arg) {
    const runs = await listRuns({ artifactRootDir: artifactPaths.rootDir });
    const inactive = runs.filter((r) => r.process.status !== "active");
    if (inactive.length === 0) {
      process.stdout.write("No resumable runs.\n");
      return;
    }
    process.stdout.write(
      [
        "Resumable runs:",
        ...inactive.map((r) => `- ${r.state.runId}`),
        "",
      ].join("\n"),
    );
    return;
  }

  const stateFilePath =
    arg.includes("/") || arg.includes("\\") || arg.endsWith(".json")
      ? path.resolve(arg)
      : getStateFilePathForRunId({ artifactRootDir: artifactPaths.rootDir, runId: arg });

  const state = await loadOttoState(stateFilePath);
  const existing = await readRunLockFile(state.lockFilePath);
  if (existing) {
    const stale = await isRunLockStale({ lock: existing });
    if (!stale) {
      fail(`Run is active (pid ${existing.pid}).`);
      return;
    }
    await fs.rm(state.lockFilePath, { force: true });
  }

  await acquireRunLock({
    lockFilePath: state.lockFilePath,
    runId: state.runId,
    stateFilePath: state.stateFilePath,
  });

  const prompt = await getPromptAdapter(config);
  try {
    const result = await runOttoRun({
      state,
      stateFilePath: state.stateFilePath,
      config,
      prompt,
    });
    process.stdout.write(
      [
        `Run stopped at phase: ${result.stoppedAtPhase}`,
        `Plan file: ${result.planFilePath}`,
        "",
      ].join("\n"),
    );
  } finally {
    await releaseRunLock(state.lockFilePath);
  }
}

async function handleActiveCommand(): Promise<void> {
  const { config } = await loadConfigFromCwd();
  const runner = getProjectLeadRunner(config);
  if (!runner) {
    failNoRunner();
    return;
  }

  const mainRepoPath = await config.worktree.adapter.getMainRepoPath(process.cwd());
  const { artifactPaths } = await ensureRepoSetup({ mainRepoPath, config });
  const runs = await listRuns({ artifactRootDir: artifactPaths.rootDir });
  const active = runs.filter((r) => r.process.status === "active");
  if (active.length === 0) {
    process.stdout.write("No active runs.\n");
    return;
  }
  process.stdout.write(["Active runs:", ...active.map((r) => `- ${r.state.runId}`), ""].join("\n"));
}

async function handleDeleteCommand(args: string[]): Promise<void> {
  const { config } = await loadConfigFromCwd();
  const runner = getProjectLeadRunner(config);
  if (!runner) {
    failNoRunner();
    return;
  }

  const mainRepoPath = await config.worktree.adapter.getMainRepoPath(process.cwd());
  const { artifactPaths } = await ensureRepoSetup({ mainRepoPath, config });

  const arg = (args[0] ?? "").trim();
  if (!arg) {
    const runs = await listRuns({ artifactRootDir: artifactPaths.rootDir });
    if (runs.length === 0) {
      process.stdout.write("No runs found.\n");
      return;
    }
    process.stdout.write(
      [
        "Runs:",
        ...runs.map((r) => `- ${r.state.runId}${r.process.status === "active" ? " (active)" : ""}`),
        "",
        "otto delete requires <ticket|state>",
        "",
      ].join("\n"),
    );
    process.exitCode = 1;
    return;
  }

  const stateFilePath =
    arg.includes("/") || arg.includes("\\") || arg.endsWith(".json")
      ? path.resolve(arg)
      : getStateFilePathForRunId({ artifactRootDir: artifactPaths.rootDir, runId: arg });
  const state = await loadOttoState(stateFilePath);

  const lock = await readRunLockFile(state.lockFilePath);
  if (lock) {
    const stale = await isRunLockStale({ lock });
    if (!stale) {
      const exec = createNodeExec();
      await killOttoProcess({ pid: lock.pid, exec, cwd: state.mainRepoPath });
    }
    await fs.rm(state.lockFilePath, { force: true });
  }

  const prompt = await getPromptAdapter(config);
  await runOttoCleanup({
    state,
    config,
    prompt,
    force: true,
    deleteBranch: true,
    deleteArtifacts: true,
  });

  await fs.rm(state.stateFilePath, { force: true });
  await fs.rm(state.lockFilePath, { force: true });

  process.stdout.write(
    [
      `Deleted run: ${state.runId}`,
      `Preserved ticket: ${state.ticket.filePath}`,
      "",
    ].join("\n"),
  );
}

async function handleRootCommand(): Promise<void> {
  if (!isInteractiveAvailable()) {
    printNonInteractiveSnippet();
    process.exitCode = 1;
    return;
  }

  const { config } = await loadConfigFromCwd();
  const runner = getProjectLeadRunner(config);
  if (!runner) {
    failNoRunner();
    return;
  }

  const mainRepoPath = await config.worktree.adapter.getMainRepoPath(process.cwd());
  const { artifactPaths } = await ensureRepoSetup({ mainRepoPath, config });
  const prompt = await getPromptAdapter(config);

  while (true) {
    const action = await prompt.select(
      [LOGO, "", "Select an action:"].join("\n"),
      {
        choices: [
          "Create Ticket",
          "Start Run",
          "Resume Run",
          "Delete Run",
          "Config",
          "Exit",
        ],
      },
    );

    if (action === "Exit") return;

    if (action === "Config") {
      await handleConfigCommand();
      continue;
    }

    if (action === "Create Ticket") {
      const ticketText = (await prompt.text("Enter ticket request:", {})).trim();
      if (!ticketText) continue;
      const created = await runTicketCreate({
        repoPath: mainRepoPath,
        runner,
        ticketText,
      });
      const next = await prompt.select(`Ticket created: ${created.ticketId}`, {
        choices: ["Start Run", "Amend Ticket", "Back"],
      });
      if (next === "Start Run") {
        await handleStartCommand([created.ticketId]);
      }
      if (next === "Amend Ticket") {
        const amendInstructions = (await prompt.text("Amend instructions:", {})).trim();
        if (!amendInstructions) continue;
        await runTicketAmend({
          repoPath: mainRepoPath,
          runner,
          ticketId: created.ticketId,
          amendInstructions,
        });
      }
      continue;
    }

    if (action === "Start Run") {
      const tickets = await listManagedTicketIds(mainRepoPath);
      const runs = await listRuns({ artifactRootDir: artifactPaths.rootDir });
      const started = new Set(runs.map((r) => r.state.runId));
      const available = tickets.filter((t) => !started.has(t));
      if (available.length === 0) {
        await prompt.confirm("No tickets available to start.", { defaultValue: true });
        continue;
      }
      const ticketId = await prompt.select("Select a ticket:", { choices: available });
      await handleStartCommand([ticketId]);
      continue;
    }

    if (action === "Resume Run") {
      const runs = await listRuns({ artifactRootDir: artifactPaths.rootDir });
      const inactive = runs.filter((r) => r.process.status !== "active");
      if (inactive.length === 0) {
        await prompt.confirm("No resumable runs.", { defaultValue: true });
        continue;
      }
      const runId = await prompt.select("Select a run:", {
        choices: inactive.map((r) => r.state.runId),
      });
      await handleResumeCommand([runId]);
      continue;
    }

    if (action === "Delete Run") {
      const runs = await listRuns({ artifactRootDir: artifactPaths.rootDir });
      if (runs.length === 0) {
        await prompt.confirm("No runs to delete.", { defaultValue: true });
        continue;
      }
      const runId = await prompt.select("Select a run to delete:", {
        choices: runs.map((r) => r.state.runId),
      });
      const ok = await prompt.confirm(
        `Delete run ${runId}? (ticket will be preserved)`,
        { defaultValue: false },
      );
      if (!ok) continue;
      await handleDeleteCommand([runId]);
      continue;
    }
  }
}

const commandHandlers: Record<OttoCommand, CommandHandler> = {
  root: handleRootCommand,
  help: async () => printHelp(),
  create: handleCreateCommand,
  ingest: handleIngestCommand,
  start: handleStartCommand,
  resume: handleResumeCommand,
  active: async () => handleActiveCommand(),
  delete: handleDeleteCommand,
  config: async () => handleConfigCommand(),
};

export function resolveCommandHandler(command: string): CommandHandler | null {
  return commandHandlers[command as OttoCommand] ?? null;
}

export async function runOttoCLI(argv: string[]): Promise<void> {
  try {
    const { command, args, helpRequested } = parseOttoArgs(argv);
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
  }
}
