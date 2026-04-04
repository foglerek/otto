import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import type { OttoPromptAdapter } from "@otto/ports";

import { ensureRepoSetup } from "../repo-setup.js";
import { listRuns } from "../runs/listing.js";
import { loadOttoState } from "../state.js";
import { runOttoCleanup } from "../cleanup.js";
import { createNodeExec } from "../exec.js";
import { killOttoProcess } from "../runs/kill.js";
import { isRunLockStale, readRunLockFile } from "../locks/run-lock.js";
import { listManagedTicketIds } from "../tickets/list.js";
import { runTicketCreate, runTicketIngest } from "../cli/commands/tickets.js";
import { getProjectLeadRunner } from "../cli/runner-gating.js";

import { resolveWebRepoContext } from "./web.js";

export interface OttoManagedTicketSummary {
  ticketId: string;
  filePath: string;
  hasRun: boolean;
}

export interface OttoCreateTicketResult {
  ticketId: string;
  filePath: string;
}

export interface OttoIngestTicketResult {
  ticketId: string;
  filePath: string;
}

export interface OttoDeleteRunResult {
  runId: string;
  preservedTicketPath: string;
}

function createNeverPromptAdapter(): OttoPromptAdapter {
  const fail = async (): Promise<never> => {
    throw new Error("Prompt interaction is not available for this operation.");
  };
  return {
    confirm: fail,
    text: fail,
    select: fail,
  };
}

function sanitizeUploadName(fileName: string | undefined): string {
  const trimmed = (fileName ?? "browser-ingest.md").trim();
  const basename = path.basename(trimmed);
  return basename.length > 0 ? basename : "browser-ingest.md";
}

async function withTemporaryIngestSourceFile<T>(args: {
  sourceText: string;
  sourceName?: string;
  run: (sourceFilePath: string) => Promise<T>;
}): Promise<T> {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "otto-web-ingest-"));
  const sourceFilePath = path.join(tempDir, sanitizeUploadName(args.sourceName));
  await fs.writeFile(sourceFilePath, args.sourceText, "utf8");

  try {
    return await args.run(sourceFilePath);
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true });
  }
}

async function getManagedProjectLeadContext(cwd: string) {
  const context = await resolveWebRepoContext(cwd);
  const runner = getProjectLeadRunner(context.config);
  if (!runner) {
    throw new Error("Error, need to configure at least one runner. See README");
  }

  await ensureRepoSetup({
    mainRepoPath: context.mainRepoPath,
    config: context.config,
  });

  return {
    context,
    runner,
  };
}

export async function listManagedTickets(cwd: string): Promise<OttoManagedTicketSummary[]> {
  const context = await resolveWebRepoContext(cwd);
  const { artifactPaths } = await ensureRepoSetup({
    mainRepoPath: context.mainRepoPath,
    config: context.config,
  });

  const [tickets, runs] = await Promise.all([
    listManagedTicketIds(context.mainRepoPath),
    listRuns({ artifactRootDir: artifactPaths.rootDir }),
  ]);
  const runIds = new Set(runs.map((run) => run.state.runId));

  return tickets.map((ticketId) => ({
    ticketId,
    filePath: `${context.mainRepoPath}/.otto/tickets/${ticketId}.md`,
    hasRun: runIds.has(ticketId),
  }));
}

export async function createManagedTicket(args: {
  cwd: string;
  ticketText: string;
}): Promise<OttoCreateTicketResult> {
  const ticketText = args.ticketText.trim();
  if (!ticketText) {
    throw new Error("Ticket text is required.");
  }

  const { context, runner } = await getManagedProjectLeadContext(args.cwd);

  return await runTicketCreate({
    repoPath: context.mainRepoPath,
    runner,
    ticketText,
  });
}

export async function ingestManagedTicket(args: {
  cwd: string;
  sourceText: string;
  sourceName?: string;
}): Promise<OttoIngestTicketResult> {
  if (!args.sourceText.trim()) {
    throw new Error("Ticket source text is required.");
  }

  const { context, runner } = await getManagedProjectLeadContext(args.cwd);

  return await withTemporaryIngestSourceFile({
    sourceText: args.sourceText,
    sourceName: args.sourceName,
    run: async (sourceFilePath) =>
      await runTicketIngest({
        repoPath: context.mainRepoPath,
        runner,
        sourceFilePath,
      }),
  });
}

export async function deleteManagedRun(args: {
  cwd: string;
  runId: string;
}): Promise<OttoDeleteRunResult> {
  const runId = args.runId.trim();
  if (!runId) {
    throw new Error("Run id is required.");
  }

  const context = await resolveWebRepoContext(args.cwd);
  const { artifactPaths } = await ensureRepoSetup({
    mainRepoPath: context.mainRepoPath,
    config: context.config,
  });

  const runs = await listRuns({ artifactRootDir: artifactPaths.rootDir });
  const existing = runs.find((run) => run.state.runId === runId);
  if (!existing) {
    throw new Error(`Run not found: ${runId}`);
  }

  const state = await loadOttoState(existing.stateFilePath);
  const lock = await readRunLockFile(state.lockFilePath);
  if (lock) {
    const stale = await isRunLockStale({ lock });
    if (!stale) {
      const exec = createNodeExec();
      await killOttoProcess({ pid: lock.pid, exec, cwd: state.mainRepoPath });
    }
    await fs.rm(state.lockFilePath, { force: true });
  }

  await runOttoCleanup({
    state,
    config: context.config,
    prompt: createNeverPromptAdapter(),
    force: true,
    deleteBranch: true,
    deleteArtifacts: true,
  });

  await fs.rm(state.stateFilePath, { force: true });
  await fs.rm(state.lockFilePath, { force: true });

  return {
    runId: state.runId,
    preservedTicketPath: state.ticket.filePath,
  };
}
