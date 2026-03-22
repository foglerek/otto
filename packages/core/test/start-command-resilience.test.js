import assert from "node:assert/strict";
import { test } from "node:test";

import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { interopDefault: true });
const start = await jiti(
  new URL("../src/cli/commands/start.ts", import.meta.url).href,
);

test("buildBranchCandidate adds numeric suffixes", () => {
  assert.equal(start.buildBranchCandidate("workflow-2026-03-22-foo", 0), "workflow-2026-03-22-foo");
  assert.equal(start.buildBranchCandidate("workflow-2026-03-22-foo", 1), "workflow-2026-03-22-foo-2");
  assert.equal(start.buildBranchCandidate("workflow-2026-03-22-foo", 4), "workflow-2026-03-22-foo-5");
});

test("isRecoverableWorktreeCreateError detects branch/path collisions", () => {
  assert.equal(
    start.isRecoverableWorktreeCreateError(
      new Error("fatal: a branch named 'workflow-foo' already exists"),
    ),
    true,
  );
  assert.equal(
    start.isRecoverableWorktreeCreateError(
      new Error("fatal: '/tmp/wt' is already checked out at '/tmp/wt'"),
    ),
    true,
  );
  assert.equal(
    start.isRecoverableWorktreeCreateError(
      new Error("permission denied"),
    ),
    false,
  );
});

test("createWorktreeWithBranchFallback retries with unique branch suffix", async () => {
  const seen = [];
  const config = {
    worktree: {
      worktreesDir: ".worktrees",
      adapter: {
        createWorktree: async ({ branchName }) => {
          seen.push(branchName);
          if (branchName === "workflow-2026-03-22-foo") {
            throw new Error(
              "fatal: a branch named 'workflow-2026-03-22-foo' already exists",
            );
          }
          return { worktreePath: `/tmp/${branchName}` };
        },
      },
    },
  };

  const created = await start.createWorktreeWithBranchFallback({
    config,
    mainRepoPath: "/tmp/repo",
    baseBranch: "main",
    initialBranchName: "workflow-2026-03-22-foo",
  });

  assert.deepEqual(seen, ["workflow-2026-03-22-foo", "workflow-2026-03-22-foo-2"]);
  assert.equal(created.branchName, "workflow-2026-03-22-foo-2");
  assert.equal(created.worktreePath, "/tmp/workflow-2026-03-22-foo-2");
});
