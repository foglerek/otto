import type { OttoWorkflowPhase } from "../state.js";
import type { OttoWorkflowRuntime } from "./runtime.js";

function formatHookError(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}

export async function runBeforePhaseHook(
  runtime: OttoWorkflowRuntime,
  phase: OttoWorkflowPhase,
): Promise<void> {
  await runtime.config.hooks?.beforePhase?.({
    phase,
    state: runtime.state,
    exec: runtime.exec,
  });
}

export async function runAfterPhaseHook(args: {
  runtime: OttoWorkflowRuntime;
  phase: OttoWorkflowPhase;
  result?: unknown;
  error?: unknown;
}): Promise<void> {
  await args.runtime.config.hooks?.afterPhase?.({
    phase: args.phase,
    state: args.runtime.state,
    exec: args.runtime.exec,
    result: args.result,
    ...(args.error === undefined ? {} : { error: formatHookError(args.error) }),
  });
}

export async function runBeforeStepHook(args: {
  runtime: OttoWorkflowRuntime;
  phase: OttoWorkflowPhase;
  step: string;
}): Promise<void> {
  await args.runtime.config.hooks?.beforeStep?.({
    phase: args.phase,
    step: args.step,
    state: args.runtime.state,
    exec: args.runtime.exec,
  });
}

export async function runAfterStepHook(args: {
  runtime: OttoWorkflowRuntime;
  phase: OttoWorkflowPhase;
  step: string;
  result?: unknown;
  error?: unknown;
}): Promise<void> {
  await args.runtime.config.hooks?.afterStep?.({
    phase: args.phase,
    step: args.step,
    state: args.runtime.state,
    exec: args.runtime.exec,
    result: args.result,
    ...(args.error === undefined ? {} : { error: formatHookError(args.error) }),
  });
}

export async function runPhaseWithHooks<T>(args: {
  runtime: OttoWorkflowRuntime;
  phase: OttoWorkflowPhase;
  run: () => Promise<T>;
}): Promise<T> {
  await runBeforePhaseHook(args.runtime, args.phase);
  try {
    const result = await args.run();
    await runAfterPhaseHook({
      runtime: args.runtime,
      phase: args.phase,
      result,
    });
    return result;
  } catch (error) {
    await runAfterPhaseHook({
      runtime: args.runtime,
      phase: args.phase,
      error,
    });
    throw error;
  }
}

export async function runStepWithHooks<T>(args: {
  runtime: OttoWorkflowRuntime;
  phase: OttoWorkflowPhase;
  step: string;
  run: () => Promise<T>;
}): Promise<T> {
  await runBeforeStepHook({
    runtime: args.runtime,
    phase: args.phase,
    step: args.step,
  });
  try {
    const result = await args.run();
    await runAfterStepHook({
      runtime: args.runtime,
      phase: args.phase,
      step: args.step,
      result,
    });
    return result;
  } catch (error) {
    await runAfterStepHook({
      runtime: args.runtime,
      phase: args.phase,
      step: args.step,
      error,
    });
    throw error;
  }
}
