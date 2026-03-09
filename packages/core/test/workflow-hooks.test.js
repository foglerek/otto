import assert from "node:assert/strict";
import { test } from "node:test";

import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { interopDefault: true });
const mod = await jiti(new URL("../src/workflow/hooks.ts", import.meta.url).href);

function makeRuntime(hooks = {}) {
  return {
    config: { hooks },
    state: { runId: "run-1" },
    exec: {
      run: async () => ({ exitCode: 0, stdout: "", stderr: "", timedOut: false }),
    },
  };
}

test("runPhaseWithHooks runs before and after hooks on success", async () => {
  const calls = [];
  const runtime = makeRuntime({
    beforePhase: async (ctx) => {
      calls.push(["before", ctx.phase, ctx.state.runId]);
    },
    afterPhase: async (ctx) => {
      calls.push(["after", ctx.phase, ctx.result, ctx.error]);
    },
  });

  const result = await mod.runPhaseWithHooks({
    runtime,
    phase: "execution",
    run: async () => {
      calls.push(["run"]);
      return "ok";
    },
  });

  assert.equal(result, "ok");
  assert.deepEqual(calls, [
    ["before", "execution", "run-1"],
    ["run"],
    ["after", "execution", "ok", undefined],
  ]);
});

test("runPhaseWithHooks runs after hook on error", async () => {
  const calls = [];
  const runtime = makeRuntime({
    beforePhase: async (ctx) => {
      calls.push(["before", ctx.phase]);
    },
    afterPhase: async (ctx) => {
      calls.push(["after", ctx.phase, ctx.error]);
    },
  });

  await assert.rejects(
    mod.runPhaseWithHooks({
      runtime,
      phase: "integration",
      run: async () => {
        throw new Error("phase boom");
      },
    }),
    /phase boom/,
  );

  assert.deepEqual(calls, [
    ["before", "integration"],
    ["after", "integration", "phase boom"],
  ]);
});

test("runStepWithHooks runs before and after hooks", async () => {
  const calls = [];
  const runtime = makeRuntime({
    beforeStep: async (ctx) => {
      calls.push(["before", ctx.phase, ctx.step]);
    },
    afterStep: async (ctx) => {
      calls.push(["after", ctx.phase, ctx.step, ctx.result, ctx.error]);
    },
  });

  const result = await mod.runStepWithHooks({
    runtime,
    phase: "execution",
    step: "task-execution",
    run: async () => "done",
  });

  assert.equal(result, "done");
  assert.deepEqual(calls, [
    ["before", "execution", "task-execution"],
    ["after", "execution", "task-execution", "done", undefined],
  ]);
});

test("runStepWithHooks propagates errors and records after hook", async () => {
  const calls = [];
  const runtime = makeRuntime({
    beforeStep: async (ctx) => {
      calls.push(["before", ctx.step]);
    },
    afterStep: async (ctx) => {
      calls.push(["after", ctx.step, ctx.error]);
    },
  });

  await assert.rejects(
    mod.runStepWithHooks({
      runtime,
      phase: "integration",
      step: "merge",
      run: async () => {
        throw new Error("step boom");
      },
    }),
    /step boom/,
  );

  assert.deepEqual(calls, [
    ["before", "merge"],
    ["after", "merge", "step boom"],
  ]);
});

test("hook wrappers execute run when hooks are absent", async () => {
  const runtime = makeRuntime();

  const phaseResult = await mod.runPhaseWithHooks({
    runtime,
    phase: "finalize",
    run: async () => 42,
  });
  const stepResult = await mod.runStepWithHooks({
    runtime,
    phase: "execution",
    step: "quality-check",
    run: async () => true,
  });

  assert.equal(phaseResult, 42);
  assert.equal(stepResult, true);
});
