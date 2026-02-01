import type { OttoWorkflowRuntime } from "./runtime.js";
import type { OttoWorkflowPhase } from "../state.js";

import { runAskIngestionPhase } from "./phases/ask-ingestion.js";

function ensureWorkflowPhase(runtime: OttoWorkflowRuntime): OttoWorkflowPhase {
  if (!runtime.state.workflow) {
    runtime.state.workflow = {
      phase: "ask-created",
      needsUserInput: false,
      taskQueue: [],
      taskAgentSessions: {},
      reviewerSessions: {},
    };
  }
  if (!runtime.state.workflow.phase) {
    runtime.state.workflow.phase = "ask-created";
  }
  return runtime.state.workflow.phase;
}

async function setPhase(
  runtime: OttoWorkflowRuntime,
  phase: OttoWorkflowPhase,
): Promise<void> {
  await runtime.stateStore.update((draft) => {
    if (!draft.workflow) {
      draft.workflow = {
        phase,
        needsUserInput: false,
        taskQueue: [],
        taskAgentSessions: {},
        reviewerSessions: {},
      };
      return;
    }
    draft.workflow.phase = phase;
  });
}

export async function runWorkflowOrchestrator(args: {
  runtime: OttoWorkflowRuntime;
}): Promise<{ stoppedAtPhase: OttoWorkflowPhase }> {
  const maxSteps = 50;
  for (let i = 0; i < maxSteps; i += 1) {
    const phase = ensureWorkflowPhase(args.runtime);

    if (phase === "ask-created") {
      await runAskIngestionPhase({ runtime: args.runtime });
      await setPhase(args.runtime, "ask-ingested");
      continue;
    }

    // The remaining phases are scaffolded but not implemented yet.
    return { stoppedAtPhase: phase };
  }

  throw new Error("Workflow exceeded max orchestrator steps.");
}
