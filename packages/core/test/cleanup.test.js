import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";

import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { interopDefault: true });
const cleanup = await jiti(new URL("../src/cleanup.ts", import.meta.url).href);

function makeState(root) {
  return {
    kind: "otto.state",
    version: 1,
    runId: "2026-02-04-cleanup",
    createdAt: new Date().toISOString(),
    mainRepoPath: root,
    artifactRootDir: path.join(root, ".otto"),
    stateFilePath: path.join(root, ".otto", "states", "run-2026-02-04-cleanup.json"),
    runDir: path.join(root, ".otto", "runs", "2026-02-04-cleanup"),
    lockFilePath: path.join(root, ".otto", "locks", "run-2026-02-04-cleanup.json"),
    ticket: {
      date: "2026-02-04",
      slug: "cleanup",
      filePath: path.join(root, ".otto", "tickets", "2026-02-04-cleanup.md"),
    },
    worktree: {
      mainRepoPath: root,
      worktreePath: path.join(root, ".worktrees", "otto-2026-02-04-cleanup"),
      branchName: "otto-2026-02-04-cleanup",
      baseBranch: "main",
    },
  };
}

function makePrompt() {
  return {
    confirm: async () => true,
    text: async () => "",
    select: async () => "",
  };
}

test("runOttoCleanup wraps beforeCleanup hook failures with context", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "otto-cleanup-"));
  const state = makeState(root);
  const config = {
    worktree: {
      adapter: {
        removeWorktree: async () => {
          throw new Error("should not be called");
        },
      },
      beforeCleanup: async () => {
        throw new Error("hook boom");
      },
    },
  };

  await assert.rejects(
    () =>
      cleanup.runOttoCleanup({
        state,
        config,
        prompt: makePrompt(),
        force: true,
      }),
    /beforeCleanup hook failed/,
  );
});

test("runOttoCleanup wraps worktree removal failures with path and branch", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "otto-cleanup-rm-"));
  const state = makeState(root);
  const config = {
    worktree: {
      adapter: {
        removeWorktree: async () => {
          throw new Error("remove failed");
        },
      },
    },
  };

  await assert.rejects(
    () =>
      cleanup.runOttoCleanup({
        state,
        config,
        prompt: makePrompt(),
        force: true,
      }),
    /Failed to remove worktree .*branch .*remove failed/,
  );
});

test("runOttoCleanup removes run artifact folder when deleteArtifacts=true", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "otto-cleanup-artifacts-"));
  const state = makeState(root);
  const runDir = path.join(state.artifactRootDir, "runs", state.runId);
  await fs.mkdir(runDir, { recursive: true });
  await fs.writeFile(path.join(runDir, "events.jsonl"), "{}\n", "utf8");

  const config = {
    worktree: {
      adapter: {
        removeWorktree: async () => {},
      },
    },
  };

  await cleanup.runOttoCleanup({
    state,
    config,
    prompt: makePrompt(),
    force: true,
    deleteArtifacts: true,
  });

  await assert.rejects(() => fs.stat(runDir));
});
