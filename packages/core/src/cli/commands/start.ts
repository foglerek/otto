import fs from "node:fs/promises";
import process from "node:process";

import { ensureRepoSetup } from "../../repo-setup.js";
import { listManagedTicketIds } from "../../tickets/list.js";
import { getTicketFilePathForId } from "../../tickets/paths.js";
import { buildInitialRunState } from "../../runs/state.js";
import { runOttoRun } from "../../run.js";
import { createNodeExec } from "../../exec.js";
import { output, fail, failNoRunner } from "../output.js";
import { loadConfigFromCwd, getPromptAdapter } from "../config.js";
import { hasUsableWorkflowRunners } from "../runner-gating.js";
import { pathExists } from "../utils.js";
import { acquireRunLock, parseTicketMetaFromId, releaseRunLock, writeStateFile } from "./common.js";
import { getStateFilePathForRunId } from "../../runs/paths.js";

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
    output(
      {
        action: "start",
        runId: state.runId,
        stoppedAtPhase: result.stoppedAtPhase,
        planFilePath: result.planFilePath,
      },
      [
        `Run stopped at phase: ${result.stoppedAtPhase}`,
        `Plan file: ${result.planFilePath}`,
        "",
      ],
    );
  } finally {
    await releaseRunLock(state.lockFilePath);
  }
}
