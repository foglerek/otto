import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";

import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { interopDefault: true });
const mod = await jiti(new URL("../src/index.ts", import.meta.url).href);

async function runGit(repoPath, ...args) {
  const { spawn } = await import("node:child_process");
  return await new Promise((resolve, reject) => {
    const child = spawn("git", args, { cwd: repoPath, stdio: ["ignore", "pipe", "pipe"] });
    let stderr = "";
    child.stderr.on("data", (chunk) => {
      stderr += String(chunk);
    });
    child.on("close", (code) => {
      if (code === 0) {
        resolve(undefined);
      } else {
        reject(new Error(`git ${args.join(" ")} failed (${code}): ${stderr}`));
      }
    });
    child.on("error", reject);
  });
}

async function initRepo() {
  const repo = await fs.mkdtemp(path.join(os.tmpdir(), "otto-git-worktree-"));
  await runGit(repo, "init", "-b", "main");
  await runGit(repo, "config", "user.name", "Otto Test");
  await runGit(repo, "config", "user.email", "otto@example.com");
  await fs.writeFile(path.join(repo, "README.md"), "# test\n", "utf8");
  await runGit(repo, "add", ".");
  await runGit(repo, "commit", "-m", "init");
  return repo;
}

test("adapter resolves main repo path", async () => {
  const repo = await initRepo();
  const adapter = mod.createGitWorktreeAdapter();

  const top = await adapter.getMainRepoPath(repo);
  assert.equal(await fs.realpath(top), await fs.realpath(repo));
});

test("adapter creates and removes worktree", async () => {
  const repo = await initRepo();
  const adapter = mod.createGitWorktreeAdapter();

  const branchName = "otto-2026-02-04-adapter";
  const created = await adapter.createWorktree({
    mainRepoPath: repo,
    baseBranch: "main",
    branchName,
    worktreesDir: ".worktrees",
  });

  await assert.doesNotReject(() => fs.stat(created.worktreePath));
  const gitDir = path.join(created.worktreePath, ".git");
  await assert.doesNotReject(() => fs.stat(gitDir));

  await adapter.removeWorktree({
    mainRepoPath: repo,
    worktreePath: created.worktreePath,
    branchName,
    deleteBranch: true,
  });

  await assert.rejects(() => fs.stat(created.worktreePath));

  const { spawn } = await import("node:child_process");
  await new Promise((resolve, reject) => {
    const child = spawn("git", ["branch", "--list", branchName], {
      cwd: repo,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      stdout += String(chunk);
    });
    child.stderr.on("data", (chunk) => {
      stderr += String(chunk);
    });
    child.on("close", (code) => {
      if (code !== 0) {
        reject(new Error(`git branch --list failed (${code}): ${stderr}`));
        return;
      }
      assert.equal(stdout.trim(), "");
      resolve();
    });
    child.on("error", reject);
  });
});

test("adapter process eviction hook is best-effort", async () => {
  const repo = await initRepo();
  const adapter = mod.createGitWorktreeAdapter();

  const branchName = "otto-2026-02-04-evict";
  const created = await adapter.createWorktree({
    mainRepoPath: repo,
    baseBranch: "main",
    branchName,
    worktreesDir: ".worktrees",
  });

  const logger = {
    info: () => {},
    warn: () => {},
    error: () => {},
  };
  const exec = {
    run: async () => ({
      exitCode: 0,
      stdout: "",
      stderr: "",
      timedOut: false,
    }),
  };

  await assert.doesNotReject(async () => {
    if (adapter.evictWorktreeProcesses) {
      await adapter.evictWorktreeProcesses({
        mainRepoPath: repo,
        worktreePath: created.worktreePath,
        branchName,
        exec,
        logger,
      });
    }
  });

  await adapter.removeWorktree({
    mainRepoPath: repo,
    worktreePath: created.worktreePath,
    branchName,
    deleteBranch: true,
  });
});
