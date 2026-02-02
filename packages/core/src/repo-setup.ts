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

  return { artifactPaths, worktreesDir };
}
