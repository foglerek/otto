import fs from "node:fs/promises";

import { ensureRepoSetup } from "../../repo-setup.js";
import { listRuns } from "../../runs/listing.js";
import { loadOttoState } from "../../state.js";
import { runOttoRun } from "../../run.js";
import { isRunLockStale, readRunLockFile } from "../../locks/run-lock.js";
import { output, fail, failNoRunner } from "../output.js";
import { reportExecEventToTerminal, reportRunEventToTerminal } from "../run-progress.js";
import { loadConfigFromCwd, getPromptAdapter } from "../config.js";
import { hasUsableWorkflowRunners } from "../runner-gating.js";
import { acquireRunLock, releaseRunLock, resolveStateFilePath } from "./common.js";
import { pathExists } from "../utils.js";

export async function handleResumeCommand(args: string[]): Promise<void> {
  const { config } = await loadConfigFromCwd();
  if (!hasUsableWorkflowRunners(config)) {
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
      output({ action: "resume", runs: [] }, ["No resumable runs.", ""]);
      return;
    }
    output(
      {
        action: "resume",
        runs: inactive.map((r) => ({ runId: r.state.runId })),
      },
      ["Resumable runs:", ...inactive.map((r) => `- ${r.state.runId}`), ""],
    );
    return;
  }

  const stateFilePath = resolveStateFilePath({
    arg,
    artifactRootDir: artifactPaths.rootDir,
  });

  if (!(await pathExists(stateFilePath))) {
    const runs = await listRuns({ artifactRootDir: artifactPaths.rootDir });
    const candidates = runs.map((r) => r.state.runId);
    const suffix =
      candidates.length > 0
        ? `\nKnown runs:\n${candidates.map((id) => `- ${id}`).join("\n")}`
        : "";
    fail(`State not found: ${arg}${suffix}`);
    return;
  }

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
      onRunEvent: reportRunEventToTerminal,
      onExecEvent: reportExecEventToTerminal,
    });
    output(
      {
        action: "resume",
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
