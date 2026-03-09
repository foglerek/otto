import type { OttoWorkflowRuntime } from "../runtime.js";
import { runMergeStep } from "../integration/merge-step.js";
import { runQualityStep } from "../integration/quality-step.js";
import { runIntegrationTestsStep } from "../integration/integration-tests-step.js";
import { runStepWithHooks } from "../hooks.js";

export async function runIntegrationPhase(args: {
  runtime: OttoWorkflowRuntime;
}): Promise<{ tasksCreated: boolean; aborted: boolean }> {
  const merge = await runStepWithHooks({
    runtime: args.runtime,
    phase: "integration",
    step: "merge",
    run: async () => await runMergeStep({ runtime: args.runtime }),
  });
  if (merge.outcome === "tasks-created") {
    return { tasksCreated: true, aborted: false };
  }
  if (merge.outcome === "aborted") {
    return { tasksCreated: false, aborted: true };
  }

  const quality = await runStepWithHooks({
    runtime: args.runtime,
    phase: "integration",
    step: "quality-gate",
    run: async () => await runQualityStep({ runtime: args.runtime }),
  });
  if (quality.outcome === "tasks-created") {
    return { tasksCreated: true, aborted: false };
  }
  if (quality.outcome === "aborted") {
    return { tasksCreated: false, aborted: true };
  }

  const integrationTests = await runStepWithHooks({
    runtime: args.runtime,
    phase: "integration",
    step: "integration-tests",
    run: async () =>
      await runIntegrationTestsStep({
        runtime: args.runtime,
      }),
  });
  if (integrationTests.outcome === "tasks-created") {
    return { tasksCreated: true, aborted: false };
  }
  if (integrationTests.outcome === "aborted") {
    return { tasksCreated: false, aborted: true };
  }

  return { tasksCreated: false, aborted: false };
}
