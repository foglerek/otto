import fs from "node:fs/promises";
import path from "node:path";

import type { OttoConfig, OttoAskMeta } from "@otto/config";

import { createNodeExec } from "./exec.js";
import {
  ensureArtifactDirs,
  ensureGitignoreHasArtifactRoot,
  resolveArtifactPaths,
} from "./artifacts.js";

function toISODate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function toSafeSlug(input: string): string {
  const s = input
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+/, "")
    .replace(/-+$/, "");
  return s || "bootstrap";
}

function runIdFromNow(): string {
  const iso = new Date().toISOString();
  return `run-${iso.replace(/[:.]/g, "-")}`;
}

async function exists(filePath: string): Promise<boolean> {
  try {
    await fs.stat(filePath);
    return true;
  } catch (err) {
    const e = err as NodeJS.ErrnoException;
    if (e.code === "ENOENT") return false;
    throw err;
  }
}

export async function runBootstrap(args: {
  cwd: string;
  config: OttoConfig;
  configPath?: string;
  slug?: string;
  date?: string;
  askText?: string;
}): Promise<{
  stateFile: string;
  artifactRootDir: string;
  askFilePath: string;
  worktreePath: string;
  branchName: string;
}> {
  const { config } = args;
  const mainRepoPath = await config.worktree.adapter.getMainRepoPath(args.cwd);

  const artifacts = resolveArtifactPaths({
    mainRepoPath,
    artifactRoot: config.paths?.artifactRoot ?? ".otto",
  });
  await ensureArtifactDirs(artifacts);
  await ensureGitignoreHasArtifactRoot({
    mainRepoPath,
    artifactRootDir: artifacts.rootDir,
  });

  // Otto uses git worktrees; ensure the configured worktrees directory is ignored.
  const worktreesDir = path.resolve(
    mainRepoPath,
    config.worktree.worktreesDir ?? ".worktrees",
  );
  await ensureGitignoreHasArtifactRoot({
    mainRepoPath,
    artifactRootDir: worktreesDir,
  });

  const date = (args.date ?? toISODate(new Date())).trim();
  const slug = toSafeSlug(args.slug ?? "bootstrap");
  const askFileName = `${date}-${slug}.md`;
  const askFilePath = path.join(artifacts.asksDir, askFileName);

  if (await exists(askFilePath)) {
    throw new Error(`Ask already exists: ${askFilePath}`);
  }

  const askBody = args.askText?.trim()
    ? args.askText.trim() + "\n"
    : "Describe what you want Otto to do.\n";

  await fs.writeFile(askFilePath, `# ${slug}\n\n${askBody}`, "utf8");

  const ask: OttoAskMeta = {
    date,
    slug,
    filePath: askFilePath,
  };

  const branchName = config.worktree.branchNamer({ ask });
  const baseBranch = config.worktree.baseBranch;

  const { worktreePath } = await config.worktree.adapter.createWorktree({
    mainRepoPath,
    baseBranch,
    branchName,
    worktreesDir: config.worktree.worktreesDir,
  });

  const envVars: Record<string, string> = {};
  const testEnvVars: Record<string, string> = {};

  const exec = createNodeExec();
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

  await config.worktree.afterCreate({
    worktree: {
      mainRepoPath,
      worktreePath,
      branchName,
      baseBranch,
    },
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

  const runId = runIdFromNow();
  const stateFile = path.join(artifacts.statesDir, `${runId}.json`);

  const state = {
    version: 1,
    runId,
    createdAt: new Date().toISOString(),
    configPath: args.configPath ? path.resolve(args.configPath) : undefined,
    mainRepoPath,
    artifactRootDir: artifacts.rootDir,
    workflow: {
      phase: "ask-created",
      needsUserInput: false,
      taskQueue: [],
      taskAgentSessions: {},
      reviewerSessions: {},
    },
    ask,
    worktree: {
      worktreePath,
      branchName,
      baseBranch,
    },
    env: envVars,
    testEnv: testEnvVars,
  };

  await fs.writeFile(stateFile, JSON.stringify(state, null, 2) + "\n", "utf8");
  return {
    stateFile,
    artifactRootDir: artifacts.rootDir,
    askFilePath,
    worktreePath,
    branchName,
  };
}
