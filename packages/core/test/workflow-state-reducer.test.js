import assert from "node:assert/strict";
import { test } from "node:test";

import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { interopDefault: true });
const reducer = await jiti(new URL("../src/workflow/state-reducer.ts", import.meta.url).href);

function makeState() {
  return {
    kind: "otto.state",
    version: 1,
    runId: "2026-02-01-sample",
    createdAt: new Date().toISOString(),
    mainRepoPath: "/tmp/repo",
    artifactRootDir: "/tmp/repo/.otto",
    stateFilePath: "/tmp/repo/.otto/states/run-2026-02-01-sample.json",
    runDir: "/tmp/repo/.otto/runs/2026-02-01-sample",
    lockFilePath: "/tmp/repo/.otto/locks/run-2026-02-01-sample.json",
    ticket: {
      date: "2026-02-01",
      slug: "sample",
      filePath: "/tmp/repo/.otto/tickets/2026-02-01-sample.md",
    },
    worktree: {
      worktreePath: "/tmp/repo/.worktrees/otto-2026-02-01-sample",
      branchName: "otto-2026-02-01-sample",
      baseBranch: "main",
    },
  };
}

test("set-task-queue initializes workflow with execution default phase", () => {
  const state = makeState();
  reducer.applyWorkflowAction(state, {
    type: "set-task-queue",
    queue: ["/tmp/task-1.md"],
    defaultPhase: "execution",
  });

  assert.equal(state.workflow.phase, "execution");
  assert.deepEqual(state.workflow.taskQueue, ["/tmp/task-1.md"]);
  assert.deepEqual(state.workflow.taskAgentSessions, {});
  assert.deepEqual(state.workflow.reviewerSessions, {});
});

test("set-phase updates workflow phase", () => {
  const state = makeState();
  reducer.applyWorkflowAction(state, { type: "set-phase", phase: "integration" });
  assert.equal(state.workflow.phase, "integration");
});

test("set-tech-lead-session adds and clears session id", () => {
  const state = makeState();
  reducer.applyWorkflowAction(state, {
    type: "set-tech-lead-session",
    sessionId: "abc",
  });
  assert.equal(state.workflow.techLeadSessionId, "abc");

  reducer.applyWorkflowAction(state, {
    type: "set-tech-lead-session",
    sessionId: null,
  });
  assert.equal(state.workflow.techLeadSessionId, undefined);
});
