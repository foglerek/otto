import fs from "node:fs/promises";
import path from "node:path";

import type { OttoConfig } from "@otto/config";

import {
  type OttoArtifactPaths,
  ensureArtifactDirs,
  ensureGitignoreHasArtifactRoot,
  ensureGitignoreHasDir,
  resolveArtifactPaths,
} from "./artifacts.js";

async function ensureOnboardingStateFile(args: {
  mainRepoPath: string;
  artifactRootDir: string;
  worktreesDir: string;
  stateFilePath: string;
}): Promise<void> {
  try {
    await fs.stat(args.stateFilePath);
    return;
  } catch (error) {
    const err = error as NodeJS.ErrnoException;
    if (err.code !== "ENOENT") throw error;
  }

  const now = new Date().toISOString();
  const payload = {
    kind: "otto.onboarding",
    version: 1,
    status: "initialized",
    createdAt: now,
    updatedAt: now,
    mainRepoPath: path.resolve(args.mainRepoPath),
    artifactRootDir: path.resolve(args.artifactRootDir),
    worktreesDir: path.resolve(args.worktreesDir),
  };

  await fs.writeFile(args.stateFilePath, JSON.stringify(payload, null, 2), {
    encoding: "utf8",
    flag: "wx",
  });
}

export async function ensureRepoSetup(args: {
  mainRepoPath: string;
  config: OttoConfig;
}): Promise<{ artifactPaths: OttoArtifactPaths; worktreesDir: string }> {
  const artifactPaths = resolveArtifactPaths({
    mainRepoPath: args.mainRepoPath,
    artifactRoot: args.config.paths?.artifactRoot,
  });

  await ensureArtifactDirs(artifactPaths);
  await ensureGitignoreHasArtifactRoot({
    mainRepoPath: args.mainRepoPath,
    artifactRootDir: artifactPaths.rootDir,
  });

  const worktreesDir = path.resolve(
    args.mainRepoPath,
    args.config.worktree.worktreesDir ?? ".worktrees",
  );
  await fs.mkdir(worktreesDir, { recursive: true });
  await ensureGitignoreHasDir({ mainRepoPath: args.mainRepoPath, dirPath: worktreesDir });

  const onboardingStatePath = path.join(artifactPaths.statesDir, "onboarding.json");
  await ensureOnboardingStateFile({
    mainRepoPath: args.mainRepoPath,
    artifactRootDir: artifactPaths.rootDir,
    worktreesDir,
    stateFilePath: onboardingStatePath,
  });

  return { artifactPaths, worktreesDir };
}
