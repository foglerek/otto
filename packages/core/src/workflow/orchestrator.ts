import type { OttoWorkflowRuntime } from "./runtime.js";
import type { OttoWorkflowPhase } from "../state.js";

import { runAskIngestionPhase } from "./phases/ask-ingestion.js";
import { runDecisionCardsGatePhase } from "./phases/decision-cards-gate.js";
import { runPlanFeedbackPhase } from "./phases/plan-feedback.js";
import { runTaskSplittingPhase } from "./phases/task-splitting.js";
import { runTaskFeedbackPhase } from "./phases/task-feedback.js";
import { runExecutionPhase } from "./phases/execution.js";
import { runUserFeedbackPhase } from "./phases/user-feedback.js";
import { runIntegrationPhase } from "./phases/integration.js";
import { runFinalizePhase } from "./phases/finalize.js";

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

    if (phase === "ask-ingested") {
      await runDecisionCardsGatePhase({ runtime: args.runtime });
      await setPhase(args.runtime, "decision-cards");
      continue;
    }

    if (phase === "decision-cards") {
      await runPlanFeedbackPhase({ runtime: args.runtime });
      await setPhase(args.runtime, "plan-created");
      continue;
    }

    if (phase === "plan-created") {
      await setPhase(args.runtime, "task-splitting");
      continue;
    }

    if (phase === "task-splitting") {
      await runTaskSplittingPhase({ runtime: args.runtime });
      await setPhase(args.runtime, "task-feedback");
      continue;
    }

    if (phase === "task-feedback") {
      await runTaskFeedbackPhase({ runtime: args.runtime });
      await setPhase(args.runtime, "execution");
      continue;
    }

    if (phase === "execution") {
      await runExecutionPhase({ runtime: args.runtime });
      await setPhase(args.runtime, "user-feedback");
      continue;
    }

    if (phase === "user-feedback") {
      const { reenterExecution } = await runUserFeedbackPhase({
        runtime: args.runtime,
      });
      await setPhase(
        args.runtime,
        reenterExecution ? "execution" : "integration",
      );
      continue;
    }

    if (phase === "integration") {
      const result = await runIntegrationPhase({ runtime: args.runtime });
      if (result.tasksCreated) {
        await setPhase(args.runtime, "execution");
        continue;
      }
      if (result.aborted) {
        return { stoppedAtPhase: "integration" };
      }
      await setPhase(args.runtime, "finalize");
      continue;
    }

    if (phase === "finalize") {
      await runFinalizePhase({ runtime: args.runtime });
      await setPhase(args.runtime, "cleanup");
      continue;
    }

    if (phase === "cleanup") {
      return { stoppedAtPhase: "cleanup" };
    }

    return { stoppedAtPhase: phase };
  }

  throw new Error("Workflow exceeded max orchestrator steps.");
}
