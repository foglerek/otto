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

async function pathExists(targetPath: string): Promise<boolean> {
  try {
    await fs.access(targetPath);
    return true;
  } catch {
    return false;
  }
}

async function branchExists(repoPath: string, branchName: string): Promise<boolean> {
  try {
    await run(
      "git",
      ["-C", repoPath, "rev-parse", "--verify", "--quiet", branchName],
      repoPath,
    );
    return true;
  } catch {
    return false;
  }
}

async function listWorktreePids(worktreePath: string): Promise<number[]> {
  return await new Promise((resolve, reject) => {
    const child = spawn("lsof", ["-t", "+D", worktreePath], {
      stdio: ["ignore", "pipe", "pipe"],
      env: process.env,
    });

    let stdout = "";
    let settled = false;

    child.stdout.on("data", (d) => {
      stdout += String(d);
    });

    child.on("error", (error) => {
      if (settled) return;
      settled = true;
      const errno = error as NodeJS.ErrnoException;
      if (errno.code === "ENOENT") {
        resolve([]);
        return;
      }
      reject(error);
    });

    child.on("close", (code) => {
      if (settled) return;
      settled = true;

      if (code !== 0 && stdout.trim().length === 0) {
        resolve([]);
        return;
      }

      const pids = Array.from(
        new Set(
          stdout
            .split(/\r?\n/)
            .map((line) => Number.parseInt(line.trim(), 10))
            .filter((pid) => Number.isInteger(pid) && pid > 1),
        ),
      );

      resolve(pids);
    });
  });
}

function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    const errno = error as NodeJS.ErrnoException;
    if (errno.code === "ESRCH") {
      return false;
    }
    return true;
  }
}

function trySignalProcess(
  pid: number,
  signal: NodeJS.Signals,
): { ok: boolean; reason?: string } {
  try {
    process.kill(pid, signal);
    return { ok: true };
  } catch (error) {
    const errno = error as NodeJS.ErrnoException;
    if (errno.code === "ESRCH") {
      return { ok: false, reason: "already-exited" };
    }
    return { ok: false, reason: errno.code ?? String(error) };
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
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
    if (await pathExists(args.worktreePath)) {
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
    }
    await run(
      "git",
      ["-C", args.mainRepoPath, "worktree", "prune"],
      args.mainRepoPath,
    );

    if (args.deleteBranch && (await branchExists(args.mainRepoPath, args.branchName))) {
      await run(
        "git",
        ["-C", args.mainRepoPath, "branch", "-D", args.branchName],
        args.mainRepoPath,
      );
    }
  }

  async evictWorktreeProcesses(
    args: Parameters<
      NonNullable<OttoWorktreeAdapter["evictWorktreeProcesses"]>
    >[0],
  ): Promise<void> {
    const pids = await listWorktreePids(args.worktreePath);
    const targets = pids.filter((pid) => pid !== process.pid);

    if (targets.length === 0) {
      return;
    }

    args.logger.warn("Evicting processes using worktree before removal.", {
      worktreePath: args.worktreePath,
      pidCount: targets.length,
    });

    for (const pid of targets) {
      const term = trySignalProcess(pid, "SIGTERM");
      if (!term.ok && term.reason !== "already-exited") {
        args.logger.warn("Failed to SIGTERM process using worktree.", {
          pid,
          reason: term.reason,
        });
      }
    }

    await sleep(400);

    const stillRunning = targets.filter((pid) => isProcessAlive(pid));
    for (const pid of stillRunning) {
      const kill = trySignalProcess(pid, "SIGKILL");
      if (!kill.ok && kill.reason !== "already-exited") {
        args.logger.warn("Failed to SIGKILL process using worktree.", {
          pid,
          reason: kill.reason,
        });
      }
    }

    const stubborn = stillRunning.filter((pid) => isProcessAlive(pid));
    if (stubborn.length > 0) {
      args.logger.warn("Some worktree processes remained after eviction.", {
        worktreePath: args.worktreePath,
        pids: stubborn,
      });
    }
  }
}

export function createGitWorktreeAdapter(): OttoWorktreeAdapter {
  return new GitWorktreeAdapter();
}
