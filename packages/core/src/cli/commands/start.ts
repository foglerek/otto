import fs from "node:fs/promises";
import process from "node:process";

import { ensureRepoSetup } from "../../repo-setup.js";
import { listManagedTicketIds } from "../../tickets/list.js";
import { getTicketFilePathForId } from "../../tickets/paths.js";
import { buildInitialRunState } from "../../runs/state.js";
import { runOttoRun } from "../../run.js";
import { createNodeExec } from "../../exec.js";
import { createTrackedPromptAdapter } from "../../prompt-state.js";
import { output, fail, failNoRunner } from "../output.js";
import {
  reportExecEventToTerminal,
  reportExecStartToTerminal,
  reportRunEventToTerminal,
} from "../run-progress.js";
import { maybeRunPostCleanupMergeBack } from "../post-run-merge-back.js";
import { loadConfigFromCwd, getPromptAdapter } from "../config.js";
import { hasUsableWorkflowRunners } from "../runner-gating.js";
import { pathExists } from "../utils.js";
import { acquireRunLock, parseTicketMetaFromId, releaseRunLock, writeStateFile } from "./common.js";
import { getStateFilePathForRunId } from "../../runs/paths.js";
import type { OttoWorkflowPhase } from "../../state.js";

const WORKTREE_CREATE_BRANCH_ATTEMPTS = 6;

export function isRecoverableWorktreeCreateError(error: unknown): boolean {
  const text = error instanceof Error ? error.message : String(error);
  const normalized = text.toLowerCase();
  return (
    normalized.includes("already exists") ||
    normalized.includes("already checked out") ||
    normalized.includes("is a missing but already registered worktree")
  );
}

export function buildBranchCandidate(baseBranchName: string, attempt: number): string {
  if (attempt <= 0) return baseBranchName;
  return `${baseBranchName}-${attempt + 1}`;
}

export async function createWorktreeWithBranchFallback(args: {
  config: Awaited<ReturnType<typeof loadConfigFromCwd>>["config"];
  mainRepoPath: string;
  baseBranch: string;
  initialBranchName: string;
}): Promise<{ worktreePath: string; branchName: string }> {
  let lastError: unknown;

  for (let attempt = 0; attempt < WORKTREE_CREATE_BRANCH_ATTEMPTS; attempt += 1) {
    const branchName = buildBranchCandidate(args.initialBranchName, attempt);
    try {
      const created = await args.config.worktree.adapter.createWorktree({
        mainRepoPath: args.mainRepoPath,
        baseBranch: args.baseBranch,
        branchName,
        worktreesDir: args.config.worktree.worktreesDir,
      });
      return { worktreePath: created.worktreePath, branchName };
    } catch (error) {
      lastError = error;
      if (!isRecoverableWorktreeCreateError(error)) {
        throw error;
      }
    }
  }

  throw lastError instanceof Error
    ? new Error(
        `Unable to allocate a unique worktree branch after ${WORKTREE_CREATE_BRANCH_ATTEMPTS} attempts: ${lastError.message}`,
      )
    : new Error(
        `Unable to allocate a unique worktree branch after ${WORKTREE_CREATE_BRANCH_ATTEMPTS} attempts.`,
      );
}

export async function cleanupFailedWorktreeStart(args: {
  config: Awaited<ReturnType<typeof loadConfigFromCwd>>["config"];
  mainRepoPath: string;
  worktreePath: string;
  branchName: string;
  baseBranch: string;
  exec: ReturnType<typeof createNodeExec>;
  envVars: Record<string, string>;
  testEnvVars: Record<string, string>;
}): Promise<void> {
  const logger = {
    info: (msg: string) => {
      process.stdout.write(`[info] ${msg}\n`);
    },
    warn: (msg: string) => {
      process.stderr.write(`[warn] ${msg}\n`);
    },
    error: (msg: string) => {
      process.stderr.write(`[error] ${msg}\n`);
    },
  };

  if (typeof args.config.worktree.beforeCleanup === "function") {
    try {
      await args.config.worktree.beforeCleanup({
        worktree: {
          mainRepoPath: args.mainRepoPath,
          worktreePath: args.worktreePath,
          branchName: args.branchName,
          baseBranch: args.baseBranch,
        },
        exec: args.exec,
        env: {
          set: (key, value) => {
            args.envVars[key] = value;
          },
        },
        testEnv: {
          set: (key, value) => {
            args.testEnvVars[key] = value;
          },
        },
        services: {},
        logger,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      process.stderr.write(
        `[warn] Cleanup hook failed after setup error: ${message}\n`,
      );
    }
  }

  try {
    await args.config.worktree.adapter.removeWorktree({
      mainRepoPath: args.mainRepoPath,
      worktreePath: args.worktreePath,
      branchName: args.branchName,
      deleteBranch: true,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(
      `[warn] Failed to remove worktree after setup error: ${message}\n`,
    );
  }
}

async function getTrackedPromptForRun(args: {
  config: Awaited<ReturnType<typeof loadConfigFromCwd>>["config"];
  stateFilePath: string;
  defaultPhase?: OttoWorkflowPhase;
}) {
  return createTrackedPromptAdapter({
    prompt: await getPromptAdapter(args.config),
    stateFilePath: args.stateFilePath,
    defaultPhase: args.defaultPhase ?? "ticket-created",
  });
}

export async function handleStartCommand(args: string[]): Promise<void> {
  const ticketId = (args[0] ?? "").trim();
  if (!ticketId || args.length !== 1) {
    fail("otto start requires <ticket>");
    return;
  }

  const { config, configPath } = await loadConfigFromCwd();
  if (!hasUsableWorkflowRunners(config)) {
    failNoRunner();
    return;
  }

  const mainRepoPath = await config.worktree.adapter.getMainRepoPath(process.cwd());
  const { artifactPaths } = await ensureRepoSetup({ mainRepoPath, config });

  const ticketFilePath = getTicketFilePathForId({ repoPath: mainRepoPath, ticketId });
  if (!(await pathExists(ticketFilePath))) {
    const candidates = await listManagedTicketIds(mainRepoPath);
    const suffix =
      candidates.length > 0
        ? `\nAvailable tickets:\n${candidates.map((id) => `- ${id}`).join("\n")}`
        : "";
    fail(`Ticket not found: ${ticketId}${suffix}`);
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

  const exec = createNodeExec();
  const envVars: Record<string, string> = {}, testEnvVars: Record<string, string> = {};
  const baseBranch = config.worktree.baseBranch;
  const created = await createWorktreeWithBranchFallback({
    config,
    mainRepoPath,
    baseBranch,
    initialBranchName: branchName,
  });
  const resolvedBranchName = created.branchName;
  const worktreePath = created.worktreePath;

  try {
    await config.worktree.afterCreate({
      worktree: {
        mainRepoPath,
        worktreePath,
        branchName: resolvedBranchName,
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
  } catch (error) {
    await cleanupFailedWorktreeStart({
      config,
      mainRepoPath,
      worktreePath,
      branchName: resolvedBranchName,
      baseBranch,
      exec,
      envVars,
      testEnvVars,
    });
    throw error;
  }

  const state = buildInitialRunState({
    mainRepoPath,
    artifactRootDir: artifactPaths.rootDir,
    configPath,
    ticketId,
    ticketFilePath,
    worktreePath,
    branchName: resolvedBranchName,
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

  const prompt = await getTrackedPromptForRun({
    config,
    stateFilePath: state.stateFilePath,
    defaultPhase: state.workflow?.phase ?? "ticket-created",
  });
  try {
    const result = await runOttoRun({
      state,
      stateFilePath: state.stateFilePath,
      config,
      prompt,
      onRunEvent: reportRunEventToTerminal,
      onExecStart: reportExecStartToTerminal,
      onExecEvent: reportExecEventToTerminal,
    });
    const mergeBack =
      result.stoppedAtPhase === "cleanup"
        ? await maybeRunPostCleanupMergeBack({ state, config, prompt })
        : null;
    output(
      {
        action: "start",
        runId: state.runId,
        stoppedAtPhase: result.stoppedAtPhase,
        planFilePath: result.planFilePath,
        finalReportPath: result.finalReportPath,
        mergeBack,
      },
      [
        `Run stopped at phase: ${result.stoppedAtPhase}`,
        result.stoppedAtPhase === "cleanup"
          ? `Final report: ${result.finalReportPath}`
          : `Plan file: ${result.planFilePath}`,
        ...(mergeBack ? [`Merge-back: ${mergeBack.message}`] : []),
        "",
      ],
    );
  } finally {
    await releaseRunLock(state.lockFilePath);
  }
}
