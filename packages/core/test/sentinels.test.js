import assert from "node:assert/strict";
import { test } from "node:test";

import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { interopDefault: true });
const sentinels = await jiti(
  new URL("../src/workflow/sentinels.ts", import.meta.url).href,
);
const microRetry = await jiti(
  new URL("../src/workflow/micro-retry.ts", import.meta.url).href,
);

function makeRuntime(taskRun) {
  return {
    config: {},
    prompt: {},
    exec: {},
    registry: {},
    stateStore: {
      state: {
        kind: "otto.state",
        version: 1,
        runId: "2026-03-22-sentinel",
      },
      save: async () => {},
      update: async () => ({}),
    },
    state: {
      kind: "otto.state",
      version: 1,
      runId: "2026-03-22-sentinel",
      createdAt: new Date().toISOString(),
      mainRepoPath: "/tmp/repo",
      artifactRootDir: "/tmp/repo/.otto",
      stateFilePath: "/tmp/repo/.otto/states/run-2026-03-22-sentinel.json",
      runDir: "/tmp/repo/.otto/runs/2026-03-22-sentinel",
      lockFilePath: "/tmp/repo/.otto/locks/run-2026-03-22-sentinel.json",
      ticket: {
        date: "2026-03-22",
        slug: "sentinel",
        filePath: "/tmp/repo/.otto/tickets/2026-03-22-sentinel.md",
      },
      worktree: {
        worktreePath: "/tmp/repo/.worktrees/workflow-2026-03-22-sentinel",
        branchName: "workflow-2026-03-22-sentinel",
        baseBranch: "main",
      },
    },
    runners: {
      lead: { run: async () => ({ success: false }) },
      task: { run: taskRun },
      reviewer: { run: async () => ({ success: false }) },
      summarize: { run: async () => ({ success: false }) },
    },
    reminders: {
      techLead: [],
      task: [],
      reviewer: [],
    },
    events: {
      append: async () => {},
      appendExec: async () => {},
    },
  };
}

test("matchOutputSentinel handles token and case-insensitive tags", () => {
  assert.equal(sentinels.hasOkSentinel("done\n<ok>\n"), true);

  const decision = sentinels.matchOutputSentinel(
    "<decision>Acceptance</decision>",
    {
      type: "tag",
      tag: "DECISION",
      allowedValues: ["acceptance", "remediation"],
      caseInsensitive: true,
    },
  );

  assert.equal(decision.matched, true);
  assert.equal(decision.value, "acceptance");
});

test("ensureSentinelWithMicroRetry uses shared sentinel parsing", async () => {
  let calls = 0;
  const runtime = makeRuntime(async () => {
    calls += 1;
    return {
      success: true,
      outputText: "<decision>ACCEPTANCE</decision>",
      sessionId: "sess-1",
    };
  });

  const ok = await microRetry.ensureSentinelWithMicroRetry({
    runtime,
    role: "task",
    sessionId: "sess-1",
    outputText: "No decision yet",
    message: "Provide decision tag",
    sentinelSpec: {
      type: "tag",
      tag: "DECISION",
      allowedValues: ["acceptance", "remediation"],
      caseInsensitive: true,
    },
  });

  assert.equal(ok, true);
  assert.equal(calls, 1);
});
