import assert from "node:assert/strict";
import { test } from "node:test";

import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { interopDefault: true });
const mod = await jiti(
  new URL("../src/workflow/task-loop.ts", import.meta.url).href,
);

test("selectTaskRecoveryAction maps skip choice", async () => {
  let seenMessage;
  let seenOptions;
  const runtime = {
    prompt: {
      select: async (message, options) => {
        seenMessage = message;
        seenOptions = options;
        return "Skip and advance";
      },
    },
  };

  const action = await mod.selectTaskRecoveryAction({
    runtime,
    taskFile: "/tmp/run/task-1-thing.md",
    reason: "execution",
  });

  assert.equal(action, "skip-and-advance");
  assert.match(seenMessage, /task-1-thing\.md/i);
  assert.match(seenMessage, /execution/i);
  assert.deepEqual(seenOptions.choices, [
    "Restart task",
    "Skip and advance",
    "Abort run",
  ]);
  assert.equal(seenOptions.defaultValue, "Restart task");
});

test("selectTaskRecoveryAction maps abort and unknown choices", async () => {
  const runtimeAbort = {
    prompt: {
      select: async () => "Abort run",
    },
  };
  const abortAction = await mod.selectTaskRecoveryAction({
    runtime: runtimeAbort,
    taskFile: "/tmp/run/task-2-thing.md",
    reason: "review",
  });
  assert.equal(abortAction, "abort-run");

  const runtimeUnknown = {
    prompt: {
      select: async () => "something else",
    },
  };
  const unknownAction = await mod.selectTaskRecoveryAction({
    runtime: runtimeUnknown,
    taskFile: "/tmp/run/task-3-thing.md",
    reason: "decision",
  });
  assert.equal(unknownAction, "restart-task");
});

test("applyTaskRecoveryAction restarts task", async () => {
  const calls = [];
  const queue = {
    async removeCurrentTask() {
      calls.push("remove");
    },
    async addTaskToFront(taskPath) {
      calls.push(["front", taskPath]);
    },
  };

  await mod.applyTaskRecoveryAction({
    queue,
    action: "restart-task",
    taskFile: "/tmp/run/task-4-thing.md",
    restartTaskPath: "/tmp/run/task-4-thing.md",
  });

  assert.deepEqual(calls, ["remove", ["front", "/tmp/run/task-4-thing.md"]]);
});

test("applyTaskRecoveryAction skips and aborts", async () => {
  const calls = [];
  const queue = {
    async removeCurrentTask() {
      calls.push("remove");
    },
    async addTaskToFront(taskPath) {
      calls.push(["front", taskPath]);
    },
  };

  await mod.applyTaskRecoveryAction({
    queue,
    action: "skip-and-advance",
    taskFile: "/tmp/run/task-5-thing.md",
    restartTaskPath: "/tmp/run/task-5-thing.md",
  });
  assert.deepEqual(calls, ["remove"]);

  await assert.rejects(
    mod.applyTaskRecoveryAction({
      queue,
      action: "abort-run",
      taskFile: "/tmp/run/task-6-thing.md",
      restartTaskPath: "/tmp/run/task-6-thing.md",
    }),
    /aborted by user/i,
  );
});
