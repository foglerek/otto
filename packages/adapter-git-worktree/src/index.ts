import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";

import type { OttoWorktreeAdapter } from "@otto/ports";

async function run(cmd: string, args: string[], cwd: string): Promise<string> {
  return await new Promise((resolve, reject) => {
    const child = spawn(cmd, args, {
      cwd,
      stdio: ["ignore", "pipe", "pipe"],
      env: process.env,
    });

    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (d) => {
      stdout += String(d);
    });
    child.stderr.on("data", (d) => {
      stderr += String(d);
    });

    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) return resolve(stdout.trim());
      reject(
        new Error(
          `${cmd} ${args.join(" ")} failed (${code}): ${stderr.trim()}`,
        ),
      );
    });
  });
}

class GitWorktreeAdapter implements OttoWorktreeAdapter {
  async getMainRepoPath(cwd: string): Promise<string> {
    return await run("git", ["-C", cwd, "rev-parse", "--show-toplevel"], cwd);
  }

  async createWorktree(args: {
    mainRepoPath: string;
    baseBranch: string;
    branchName: string;
    worktreesDir?: string;
  }): Promise<{ worktreePath: string }> {
    const worktreesDir = path.resolve(
      args.mainRepoPath,
      args.worktreesDir ?? ".worktrees",
    );
    const worktreePath = path.join(worktreesDir, args.branchName);

    await fs.mkdir(worktreesDir, { recursive: true });

    await run(
      "git",
      [
        "-C",
        args.mainRepoPath,
        "worktree",
        "add",
        "-b",
        args.branchName,
        worktreePath,
        args.baseBranch,
      ],
      args.mainRepoPath,
    );

    return { worktreePath };
  }

  async removeWorktree(args: {
    mainRepoPath: string;
    worktreePath: string;
    branchName: string;
    deleteBranch: boolean;
  }): Promise<void> {
    await run(
      "git",
      [
        "-C",
        args.mainRepoPath,
        "worktree",
        "remove",
        "--force",
        args.worktreePath,
      ],
      args.mainRepoPath,
    );
    await run(
      "git",
      ["-C", args.mainRepoPath, "worktree", "prune"],
      args.mainRepoPath,
    );

    if (args.deleteBranch) {
      await run(
        "git",
        ["-C", args.mainRepoPath, "branch", "-D", args.branchName],
        args.mainRepoPath,
      );
    }
  }
}

export function createGitWorktreeAdapter(): OttoWorktreeAdapter {
  return new GitWorktreeAdapter();
}
