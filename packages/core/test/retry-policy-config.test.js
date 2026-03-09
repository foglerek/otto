import assert from "node:assert/strict";
import { test } from "node:test";

import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { interopDefault: true });
const mod = await jiti(
  new URL("../src/workflow/retry-policy.ts", import.meta.url).href,
);

function makeRuntime(args = {}) {
  const state = {
    workflow: {
      autoRetryCounts: { ...(args.autoRetryCounts ?? {}) },
    },
  };
  const confirmCalls = [];

  const runtime = {
    config: args.retryPolicy ? { retryPolicy: args.retryPolicy } : {},
    state,
    stateStore: {
      state,
      async update(mutator) {
        mutator(state);
        return state;
      },
    },
    prompt: {
      async confirm(message, options) {
        confirmCalls.push({ message, options });
        return args.confirmResult ?? true;
      },
    },
  };

  return { runtime, state, confirmCalls };
}

test("retry-policy getters return defaults", () => {
  const { runtime } = makeRuntime();

  assert.equal(mod.getAutoRetryLimit(runtime), 2);
  assert.equal(mod.getDecisionCardsMaxIterations(runtime), 5);
  assert.equal(mod.getQualityFixMaxAttempts(runtime), 2);
});

test("retry-policy getters honor configured values", () => {
  const { runtime } = makeRuntime({
    retryPolicy: {
      autoRetryLimit: 4,
      decisionCardsMaxIterations: 7,
      qualityFixMaxAttempts: 1,
    },
  });

  assert.equal(mod.getAutoRetryLimit(runtime), 4);
  assert.equal(mod.getDecisionCardsMaxIterations(runtime), 7);
  assert.equal(mod.getQualityFixMaxAttempts(runtime), 1);
});

test("retry-policy getters sanitize invalid values", () => {
  const { runtime } = makeRuntime({
    retryPolicy: {
      autoRetryLimit: -1,
      decisionCardsMaxIterations: 0,
      qualityFixMaxAttempts: Number.NaN,
    },
  });

  assert.equal(mod.getAutoRetryLimit(runtime), 2);
  assert.equal(mod.getDecisionCardsMaxIterations(runtime), 5);
  assert.equal(mod.getQualityFixMaxAttempts(runtime), 2);
});

test("maybeAutoRetry auto-increments before prompting", async () => {
  const { runtime, state, confirmCalls } = makeRuntime({
    retryPolicy: { autoRetryLimit: 1 },
    autoRetryCounts: { "Task feedback": 0 },
    confirmResult: false,
  });

  const first = await mod.maybeAutoRetry({
    runtime,
    label: "Task feedback",
    defaultPhase: "task-feedback",
  });
  assert.equal(first, true);
  assert.equal(state.workflow.autoRetryCounts["Task feedback"], 1);
  assert.equal(confirmCalls.length, 0);

  const second = await mod.maybeAutoRetry({
    runtime,
    label: "Task feedback",
    defaultPhase: "task-feedback",
  });
  assert.equal(second, false);
  assert.equal(confirmCalls.length, 1);
  assert.match(confirmCalls[0].message, /Task feedback failed\. Retry\?/);
});

test("maybeAutoRetry prompts immediately when auto limit is zero", async () => {
  const { runtime, state, confirmCalls } = makeRuntime({
    retryPolicy: { autoRetryLimit: 0 },
    confirmResult: true,
  });

  const shouldRetry = await mod.maybeAutoRetry({
    runtime,
    label: "Plan feedback",
    defaultPhase: "plan-feedback",
    failureMessage: "custom retry message",
  });

  assert.equal(shouldRetry, true);
  assert.equal(state.workflow.autoRetryCounts["Plan feedback"], undefined);
  assert.equal(confirmCalls.length, 1);
  assert.equal(confirmCalls[0].message, "custom retry message");
});
