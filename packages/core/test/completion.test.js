import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";

import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { interopDefault: true });
const completion = await jiti(new URL("../src/completion.ts", import.meta.url).href);

function makeState(root) {
  return {
    kind: "otto.state",
    version: 1,
    runId: "2026-04-05-completion",
    createdAt: new Date().toISOString(),
    mainRepoPath: root,
    artifactRootDir: path.join(root, ".otto"),
    stateFilePath: path.join(root, ".otto", "states", "run-2026-04-05-completion.json"),
    runDir: path.join(root, ".otto", "runs", "2026-04-05-completion"),
    lockFilePath: path.join(root, ".otto", "locks", "run-2026-04-05-completion.json"),
    ticket: {
      date: "2026-04-05",
      slug: "completion",
      filePath: path.join(root, ".otto", "tickets", "2026-04-05-completion.md"),
    },
    worktree: {
      worktreePath: path.join(root, ".worktrees", "workflow-2026-04-05-completion"),
      branchName: "workflow-2026-04-05-completion",
      baseBranch: "main",
    },
  };
}

test("shouldFinalizeCompletedRun only finalizes merged cleanup runs", () => {
  assert.equal(completion.shouldFinalizeCompletedRun({ stoppedAtPhase: "cleanup", mergeBack: { status: "merged" } }), true);
  assert.equal(completion.shouldFinalizeCompletedRun({ stoppedAtPhase: "cleanup", mergeBack: { status: "skipped", message: "Skipped merge-back: workflow-x is already merged into main." } }), true);
  assert.equal(completion.shouldFinalizeCompletedRun({ stoppedAtPhase: "cleanup", mergeBack: { status: "skipped" } }), false);
  assert.equal(completion.shouldFinalizeCompletedRun({ stoppedAtPhase: "finalize", mergeBack: { status: "merged" } }), false);
});

test("finalizeCompletedRun honors deleteBranchOnCleanup and marks run done", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "otto-completion-"));
  const state = makeState(root);
  await fs.mkdir(state.runDir, { recursive: true });
  const calls = [];
  const config = {
    worktree: {
      baseBranch: "main",
      branchNamer: () => "x",
      afterCreate: async () => {},
      deleteBranchOnCleanup: false,
      adapter: {
        removeWorktree: async (args) => {
          calls.push(args.deleteBranch);
        },
      },
    },
  };

  await completion.finalizeCompletedRun({ state, config });

  assert.deepEqual(calls, [false]);
  const raw = JSON.parse(await fs.readFile(path.join(state.runDir, "web-ui-state.json"), "utf8"));
  assert.equal(raw.markedDone, true);
  assert.equal(typeof raw.markedDoneAt, "string");

  await fs.rm(root, { recursive: true, force: true });
});
