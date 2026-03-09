import type { OttoWorkflowPhase } from "../state.js";
import type { OttoWorkflowRuntime } from "./runtime.js";
import { dispatchWorkflowAction } from "./state-reducer.js";

const DEFAULT_AUTO_RETRY_LIMIT = 2;
const DEFAULT_DECISION_CARDS_MAX_ITERATIONS = 5;
const DEFAULT_QUALITY_FIX_MAX_ATTEMPTS = 2;

function toNonNegativeInt(value: unknown, fallback: number): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return fallback;
  }
  const normalized = Math.floor(value);
  return normalized >= 0 ? normalized : fallback;
}

function toPositiveInt(value: unknown, fallback: number): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return fallback;
  }
  const normalized = Math.floor(value);
  return normalized >= 1 ? normalized : fallback;
}

export function getAutoRetryLimit(runtime: OttoWorkflowRuntime): number {
  return toNonNegativeInt(
    runtime.config.retryPolicy?.autoRetryLimit,
    DEFAULT_AUTO_RETRY_LIMIT,
  );
}

export function getDecisionCardsMaxIterations(
  runtime: OttoWorkflowRuntime,
): number {
  return toPositiveInt(
    runtime.config.retryPolicy?.decisionCardsMaxIterations,
    DEFAULT_DECISION_CARDS_MAX_ITERATIONS,
  );
}

export function getQualityFixMaxAttempts(runtime: OttoWorkflowRuntime): number {
  return toNonNegativeInt(
    runtime.config.retryPolicy?.qualityFixMaxAttempts,
    DEFAULT_QUALITY_FIX_MAX_ATTEMPTS,
  );
}

export async function maybeAutoRetry(args: {
  runtime: OttoWorkflowRuntime;
  label: string;
  defaultPhase: OttoWorkflowPhase;
  failureMessage?: string;
}): Promise<boolean> {
  const tries = args.runtime.state.workflow?.autoRetryCounts?.[args.label] ?? 0;
  const maxAuto = getAutoRetryLimit(args.runtime);

  if (tries < maxAuto) {
    await dispatchWorkflowAction(args.runtime.stateStore, {
      type: "set-auto-retry-count",
      label: args.label,
      count: tries + 1,
      defaultPhase: args.defaultPhase,
    });
    return true;
  }

  return await args.runtime.prompt.confirm(
    args.failureMessage ?? `${args.label} failed. Retry?`,
    {
      defaultValue: true,
    },
  );
}
