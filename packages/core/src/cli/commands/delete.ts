import fs from "node:fs/promises";

import { ensureRepoSetup } from "../../repo-setup.js";
import { listRuns } from "../../runs/listing.js";
import { loadOttoState } from "../../state.js";
import { runOttoCleanup } from "../../cleanup.js";
import { createNodeExec } from "../../exec.js";
import { killOttoProcess } from "../../runs/kill.js";
import { isRunLockStale, readRunLockFile } from "../../locks/run-lock.js";
import { output, fail } from "../output.js";
import { loadConfigFromCwd, getPromptAdapter } from "../config.js";
import { resolveStateFilePath } from "./common.js";
import { pathExists } from "../utils.js";

export async function handleDeleteCommand(args: string[]): Promise<void> {
  const { config } = await loadConfigFromCwd();

  const mainRepoPath = await config.worktree.adapter.getMainRepoPath(process.cwd());
  const { artifactPaths } = await ensureRepoSetup({ mainRepoPath, config });

  const arg = (args[0] ?? "").trim();
  if (!arg) {
    const runs = await listRuns({ artifactRootDir: artifactPaths.rootDir });
    if (runs.length === 0) {
      output({ action: "delete", runs: [] }, ["No runs found.", ""]);
      return;
    }
    output(
      {
        action: "delete",
        runs: runs.map((r) => ({
          runId: r.state.runId,
          active: r.process.status === "active",
        })),
        error: "otto delete requires <ticket|state>",
      },
      [
        "Runs:",
        ...runs.map((r) => `- ${r.state.runId}${r.process.status === "active" ? " (active)" : ""}`),
        "",
        "otto delete requires <ticket|state>",
        "",
      ],
    );
    process.exitCode = 1;
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

  output(
    {
      action: "delete",
      runId: state.runId,
      preservedTicketPath: state.ticket.filePath,
    },
    [
      `Deleted run: ${state.runId}`,
      `Preserved ticket: ${state.ticket.filePath}`,
      "",
    ],
  );
}
