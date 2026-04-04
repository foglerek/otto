import process from "node:process";

import type { OttoPromptAdapter } from "@otto/ports";

import { ensureRepoSetup } from "../repo-setup.js";
import { createTrackedPromptAdapter } from "../prompt-state.js";
import { listRuns } from "../runs/listing.js";
import { listManagedTicketIds } from "../tickets/list.js";
import { getTicketFilePathForId } from "../tickets/paths.js";
import { buildInitialRunState } from "../runs/state.js";
import { getStateFilePathForRunId } from "../runs/paths.js";
import { loadOttoState } from "../state.js";
import { runOttoRun } from "../run.js";
import { createNodeExec } from "../exec.js";
import type { OttoExecEvent, OttoExecStartEvent, OttoRunEvent } from "../workflow/events.js";
import { maybeRunPostCleanupMergeBack, type MergeBackResult } from "../cli/post-run-merge-back.js";
import { hasUsableWorkflowRunners } from "../cli/runner-gating.js";
import { pathExists } from "../cli/utils.js";
import { acquireRunLock, parseTicketMetaFromId, releaseRunLock, writeStateFile } from "../cli/commands/common.js";
import {
  createWorktreeWithBranchFallback,
  cleanupFailedWorktreeStart,
} from "../cli/commands/start.js";
import { isRunLockStale, readRunLockFile } from "../locks/run-lock.js";

import { resolveWebRepoContext } from "./web.js";

export interface OttoManagedRunResult {
  runId: string;
  stoppedAtPhase: string;
  planFilePath: string;
  finalReportPath: string;
  mergeBack: MergeBackResult | null;
}

export interface OttoManagedMergeBackResult {
  runId: string;
  mergeBack: MergeBackResult;
}

interface RunCallbacks {
  onRunEvent?: (event: OttoRunEvent) => void | Promise<void>;
  onExecStart?: (event: OttoExecStartEvent) => void | Promise<void>;
  onExecEvent?: (event: OttoExecEvent) => void | Promise<void>;
}

function createHookLogger() {
  return {
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
}

async function runManagedWorkflow(args: {
  state: Awaited<ReturnType<typeof loadOttoState>>;
  config: Awaited<ReturnType<typeof resolveWebRepoContext>>["config"];
  prompt: OttoPromptAdapter;
} & RunCallbacks): Promise<OttoManagedRunResult> {
  const trackedPrompt = createTrackedPromptAdapter({
    prompt: args.prompt,
    stateFilePath: args.state.stateFilePath,
    defaultPhase: args.state.workflow?.phase ?? "ticket-created",
  });

  await acquireRunLock({
    lockFilePath: args.state.lockFilePath,
    runId: args.state.runId,
    stateFilePath: args.state.stateFilePath,
  });

  try {
    const result = await runOttoRun({
      state: args.state,
      stateFilePath: args.state.stateFilePath,
      config: args.config,
      prompt: trackedPrompt,
      onRunEvent: args.onRunEvent,
      onExecStart: args.onExecStart,
      onExecEvent: args.onExecEvent,
    });
    const mergeBack =
      result.stoppedAtPhase === "cleanup"
        ? await maybeRunPostCleanupMergeBack({
            state: args.state,
            config: args.config,
            prompt: trackedPrompt,
          })
        : null;

    return {
      runId: args.state.runId,
      stoppedAtPhase: result.stoppedAtPhase,
      planFilePath: result.planFilePath,
      finalReportPath: result.finalReportPath,
      mergeBack,
    };
  } finally {
    await releaseRunLock(args.state.lockFilePath);
  }
}

export async function startManagedRun(args: {
  cwd: string;
  ticketId: string;
  prompt: OttoPromptAdapter;
} & RunCallbacks): Promise<OttoManagedRunResult> {
  const ticketId = args.ticketId.trim();
  if (!ticketId) {
    throw new Error("otto start requires <ticket>");
  }

  const context = await resolveWebRepoContext(args.cwd);
  if (!hasUsableWorkflowRunners(context.config)) {
    throw new Error("Error, need to configure at least one runner. See README");
  }

  const { artifactPaths } = await ensureRepoSetup({
    mainRepoPath: context.mainRepoPath,
    config: context.config,
  });

  const ticketFilePath = getTicketFilePathForId({
    repoPath: context.mainRepoPath,
    ticketId,
  });
  if (!(await pathExists(ticketFilePath))) {
    const candidates = await listManagedTicketIds(context.mainRepoPath);
    const suffix =
      candidates.length > 0
        ? `\nAvailable tickets:\n${candidates.map((id) => `- ${id}`).join("\n")}`
        : "";
    throw new Error(`Ticket not found: ${ticketId}${suffix}`);
  }

  const stateFilePath = getStateFilePathForRunId({
    artifactRootDir: artifactPaths.rootDir,
    runId: ticketId,
  });
  if (await pathExists(stateFilePath)) {
    throw new Error(`Run already exists for ticket ${ticketId}. Use: otto resume ${ticketId}`);
  }

  const { date, slug } = parseTicketMetaFromId(ticketId);
  const branchName = context.config.worktree.branchNamer({
    ticket: { date, slug, filePath: ticketFilePath },
  });

  const exec = createNodeExec();
  const envVars: Record<string, string> = {};
  const testEnvVars: Record<string, string> = {};
  const baseBranch = context.config.worktree.baseBranch;
  const created = await createWorktreeWithBranchFallback({
    config: context.config,
    mainRepoPath: context.mainRepoPath,
    baseBranch,
    initialBranchName: branchName,
  });

  try {
    await context.config.worktree.afterCreate({
      worktree: {
        mainRepoPath: context.mainRepoPath,
        worktreePath: created.worktreePath,
        branchName: created.branchName,
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
      logger: createHookLogger(),
    });
  } catch (error) {
    await cleanupFailedWorktreeStart({
      config: context.config,
      mainRepoPath: context.mainRepoPath,
      worktreePath: created.worktreePath,
      branchName: created.branchName,
      baseBranch,
      exec,
      envVars,
      testEnvVars,
    });
    throw error;
  }

  const initialState = buildInitialRunState({
    mainRepoPath: context.mainRepoPath,
    artifactRootDir: artifactPaths.rootDir,
    configPath: context.configPath,
    ticketId,
    ticketFilePath,
    worktreePath: created.worktreePath,
    branchName: created.branchName,
    baseBranch,
    env: envVars,
    testEnv: testEnvVars,
  });

  await writeStateFile(initialState, initialState.stateFilePath);
  return await runManagedWorkflow({
    state: initialState,
    config: context.config,
    prompt: args.prompt,
    onRunEvent: args.onRunEvent,
    onExecStart: args.onExecStart,
    onExecEvent: args.onExecEvent,
  });
}

export async function resumeManagedRun(args: {
  cwd: string;
  runId: string;
  prompt: OttoPromptAdapter;
} & RunCallbacks): Promise<OttoManagedRunResult> {
  const runId = args.runId.trim();
  if (!runId) {
    throw new Error("otto resume requires <ticket|state>");
  }

  const context = await resolveWebRepoContext(args.cwd);
  if (!hasUsableWorkflowRunners(context.config)) {
    throw new Error("Error, need to configure at least one runner. See README");
  }

  const { artifactPaths } = await ensureRepoSetup({
    mainRepoPath: context.mainRepoPath,
    config: context.config,
  });

  const stateFilePath = getStateFilePathForRunId({
    artifactRootDir: artifactPaths.rootDir,
    runId,
  });
  if (!(await pathExists(stateFilePath))) {
    const runs = await listRuns({ artifactRootDir: artifactPaths.rootDir });
    const suffix =
      runs.length > 0
        ? `\nKnown runs:\n${runs.map((entry) => `- ${entry.state.runId}`).join("\n")}`
        : "";
    throw new Error(`State not found: ${runId}${suffix}`);
  }

  const state = await loadOttoState(stateFilePath);
  const existing = await readRunLockFile(state.lockFilePath);
  if (existing) {
    const stale = await isRunLockStale({ lock: existing });
    if (!stale) {
      throw new Error(`Run is active (pid ${existing.pid}).`);
    }
  }

  return await runManagedWorkflow({
    state,
    config: context.config,
    prompt: args.prompt,
    onRunEvent: args.onRunEvent,
    onExecStart: args.onExecStart,
    onExecEvent: args.onExecEvent,
  });
}

export async function mergeBackManagedRun(args: {
  cwd: string;
  runId: string;
  prompt: OttoPromptAdapter;
}): Promise<OttoManagedMergeBackResult> {
  const runId = args.runId.trim();
  if (!runId) {
    throw new Error("Run id is required for merge-back.");
  }

  const context = await resolveWebRepoContext(args.cwd);
  const { artifactPaths } = await ensureRepoSetup({
    mainRepoPath: context.mainRepoPath,
    config: context.config,
  });

  const stateFilePath = getStateFilePathForRunId({
    artifactRootDir: artifactPaths.rootDir,
    runId,
  });
  if (!(await pathExists(stateFilePath))) {
    throw new Error(`State not found: ${runId}`);
  }

  const state = await loadOttoState(stateFilePath);
  const existing = await readRunLockFile(state.lockFilePath);
  if (existing) {
    const stale = await isRunLockStale({ lock: existing });
    if (!stale) {
      throw new Error(`Run is active (pid ${existing.pid}).`);
    }
  }

  const mergeBack = await maybeRunPostCleanupMergeBack({
    state,
    config: context.config,
    prompt: createTrackedPromptAdapter({
      prompt: args.prompt,
      stateFilePath: state.stateFilePath,
      defaultPhase: state.workflow?.phase ?? "cleanup",
    }),
  });
  return { runId, mergeBack };
}
