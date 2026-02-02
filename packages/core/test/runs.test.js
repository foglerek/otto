import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";

import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { interopDefault: true });
const listing = await jiti(new URL("../src/runs/listing.ts", import.meta.url).href);

const makeRepo = async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "otto-runs-"));
  const ottoRoot = path.join(root, ".otto");
  await fs.mkdir(path.join(ottoRoot, "states"), { recursive: true });
  await fs.mkdir(path.join(ottoRoot, "locks"), { recursive: true });
  await fs.mkdir(path.join(ottoRoot, "runs"), { recursive: true });
  await fs.mkdir(path.join(ottoRoot, "tickets"), { recursive: true });
  return root;
};

const writeState = async (repoPath, runId, pid) => {
  const artifactRootDir = path.join(repoPath, ".otto");
  const stateFilePath = path.join(artifactRootDir, "states", `run-${runId}.json`);
  const lockFilePath = path.join(artifactRootDir, "locks", `run-${runId}.json`);
  const runDir = path.join(artifactRootDir, "runs", runId);
  const ticketFilePath = path.join(artifactRootDir, "tickets", `${runId}.md`);

  const state = {
    version: 1,
    runId,
    createdAt: new Date().toISOString(),
    mainRepoPath: repoPath,
    artifactRootDir,
    stateFilePath,
    runDir,
    lockFilePath,
    ticket: { date: runId.slice(0, 10), slug: runId.slice(11), filePath: ticketFilePath },
    worktree: { worktreePath: "/tmp/wt", branchName: "b", baseBranch: "main" },
  };

  await fs.writeFile(stateFilePath, JSON.stringify(state, null, 2), "utf8");
  if (pid != null) {
    const lock = {
      pid,
      startedAt: new Date().toISOString(),
      runId,
      stateFilePath,
    };
    await fs.writeFile(lockFilePath, JSON.stringify(lock, null, 2), "utf8");
  }
  return { stateFilePath, lockFilePath };
};

test("listRuns classifies active/inactive and clears stale locks", async () => {
  const repo = await makeRepo();
  const artifactRootDir = path.join(repo, ".otto");

  await writeState(repo, "2026-02-01-inactive", null);
  const stale = await writeState(repo, "2026-02-01-stale", 1111);
  const active = await writeState(repo, "2026-02-01-active", 2222);

  const runs = await listing.listRuns({
    artifactRootDir,
    isAlive: (pid) => pid === 2222,
    clearStaleLocks: true,
  });

  const byId = new Map(runs.map((r) => [r.state.runId, r]));
  assert.equal(byId.get("2026-02-01-inactive").process.status, "inactive");
  assert.equal(byId.get("2026-02-01-stale").process.status, "stale");
  assert.equal(byId.get("2026-02-01-active").process.status, "active");

  // stale lock file cleared
  await assert.rejects(fs.stat(stale.lockFilePath));
  // active lock remains
  await assert.doesNotReject(() => fs.stat(active.lockFilePath));
});
