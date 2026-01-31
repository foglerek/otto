import fs from "node:fs/promises";
import path from "node:path";

import type { OttoConfig } from "@otto/config";
import type { OttoPromptAdapter } from "@otto/ports";

import { createNodeExec } from "./exec.js";
import type { OttoStateV1 } from "./state.js";

async function rmrf(targetPath: string): Promise<void> {
  await fs.rm(targetPath, { recursive: true, force: true });
}

export async function runOttoCleanup(args: {
  state: OttoStateV1;
  config: OttoConfig;
  prompt: OttoPromptAdapter;
  force: boolean;
  deleteBranch: boolean;
  deleteArtifacts: boolean;
}): Promise<void> {
  const { state, config } = args;
  const worktree = {
    mainRepoPath: state.mainRepoPath,
    worktreePath: state.worktree.worktreePath,
    branchName: state.worktree.branchName,
    baseBranch: state.worktree.baseBranch,
  };

  const logger = {
    info(message: string, meta?: Record<string, unknown>) {
      process.stdout.write(
        `[info] ${message}${meta ? " " + JSON.stringify(meta) : ""}\n`,
      );
    },
    warn(message: string, meta?: Record<string, unknown>) {
      process.stdout.write(
        `[warn] ${message}${meta ? " " + JSON.stringify(meta) : ""}\n`,
      );
    },
    error(message: string, meta?: Record<string, unknown>) {
      process.stderr.write(
        `[error] ${message}${meta ? " " + JSON.stringify(meta) : ""}\n`,
      );
    },
  };

  const shouldProceed =
    args.force ||
    (await args.prompt.confirm(`Remove worktree at ${worktree.worktreePath}?`, {
      defaultValue: false,
    }));

  if (!shouldProceed) {
    logger.info("Cleanup cancelled.");
    return;
  }

  const exec = createNodeExec();
  const envVars = state.env ?? {};
  const testEnvVars = state.testEnv ?? {};

  if (config.worktree.beforeCleanup) {
    await config.worktree.beforeCleanup({
      worktree,
      exec,
      env: {
        set(key, value) {
          envVars[key] = value;
        },
      },
      testEnv: {
        set(key, value) {
          testEnvVars[key] = value;
        },
      },
      services: {},
      logger,
    });
  }

  await config.worktree.adapter.removeWorktree({
    mainRepoPath: worktree.mainRepoPath,
    worktreePath: worktree.worktreePath,
    branchName: worktree.branchName,
    deleteBranch: args.deleteBranch,
  });

  if (args.deleteArtifacts) {
    const runDir = path.join(state.artifactRootDir, "runs", state.runId);
    await rmrf(runDir);
  }
}
