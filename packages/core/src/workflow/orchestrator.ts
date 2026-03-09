import type { OttoWorkflowRuntime } from "./runtime.js";
import type { OttoWorkflowPhase } from "../state.js";
import { dispatchWorkflowAction } from "./state-reducer.js";
import { emitRunEvent } from "./events.js";
import { runPhaseWithHooks } from "./hooks.js";

import { runTicketIngestionPhase } from "./phases/ticket-ingestion.js";
import { runDecisionCardsGatePhase } from "./phases/decision-cards-gate.js";
import { runPlanFeedbackPhase } from "./phases/plan-feedback.js";
import { runTaskSplittingPhase } from "./phases/task-splitting.js";
import { runTaskFeedbackPhase } from "./phases/task-feedback.js";
import { runExecutionPhase } from "./phases/execution.js";
import { runUserFeedbackPhase } from "./phases/user-feedback.js";
import { runIntegrationPhase } from "./phases/integration.js";
import { runFinalizePhase } from "./phases/finalize.js";

async function ensureWorkflowPhase(
  runtime: OttoWorkflowRuntime,
): Promise<OttoWorkflowPhase> {
  const phase = runtime.state.workflow?.phase;
  if (phase) return phase;
  await dispatchWorkflowAction(runtime.stateStore, {
    type: "set-phase",
    phase: "ticket-created",
  });
  return runtime.state.workflow?.phase ?? "ticket-created";
}

async function setPhase(
  runtime: OttoWorkflowRuntime,
  phase: OttoWorkflowPhase,
): Promise<void> {
  const from = runtime.state.workflow?.phase ?? null;
  await dispatchWorkflowAction(runtime.stateStore, {
    type: "set-phase",
    phase,
  });
  await emitRunEvent({
    logger: runtime.events,
    runId: runtime.state.runId,
    type: "phase_transition",
    data: { from, to: phase },
  });
}

export async function runWorkflowOrchestrator(args: {
  runtime: OttoWorkflowRuntime;
}): Promise<{ stoppedAtPhase: OttoWorkflowPhase }> {
  const maxSteps = 50;
  for (let i = 0; i < maxSteps; i += 1) {
    const phase = await ensureWorkflowPhase(args.runtime);
    await emitRunEvent({
      logger: args.runtime.events,
      runId: args.runtime.state.runId,
      type: "phase_entered",
      data: { phase, step: i },
    });

    if (phase === "ticket-created") {
      await runPhaseWithHooks({
        runtime: args.runtime,
        phase,
        run: async () => {
          await runTicketIngestionPhase({ runtime: args.runtime });
        },
      });
      await setPhase(args.runtime, "ticket-ingested");
      continue;
    }

    if (phase === "ticket-ingested") {
      await runPhaseWithHooks({
        runtime: args.runtime,
        phase,
        run: async () => {
          await runDecisionCardsGatePhase({ runtime: args.runtime });
        },
      });
      await setPhase(args.runtime, "decision-cards");
      continue;
    }

    if (phase === "decision-cards") {
      await runPhaseWithHooks({
        runtime: args.runtime,
        phase,
        run: async () => {
          await runPlanFeedbackPhase({ runtime: args.runtime });
        },
      });
      await setPhase(args.runtime, "plan-created");
      continue;
    }

    if (phase === "plan-created") {
      await runPhaseWithHooks({
        runtime: args.runtime,
        phase,
        run: async () => undefined,
      });
      await setPhase(args.runtime, "task-splitting");
      continue;
    }

    if (phase === "task-splitting") {
      await runPhaseWithHooks({
        runtime: args.runtime,
        phase,
        run: async () => {
          await runTaskSplittingPhase({ runtime: args.runtime });
        },
      });
      await setPhase(args.runtime, "task-feedback");
      continue;
    }

    if (phase === "task-feedback") {
      await runPhaseWithHooks({
        runtime: args.runtime,
        phase,
        run: async () => {
          await runTaskFeedbackPhase({ runtime: args.runtime });
        },
      });
      await setPhase(args.runtime, "execution");
      continue;
    }

    if (phase === "execution") {
      await runPhaseWithHooks({
        runtime: args.runtime,
        phase,
        run: async () => {
          await runExecutionPhase({ runtime: args.runtime });
        },
      });
      await setPhase(args.runtime, "user-feedback");
      continue;
    }

    if (phase === "user-feedback") {
      const { reenterExecution } = await runPhaseWithHooks({
        runtime: args.runtime,
        phase,
        run: async () =>
          await runUserFeedbackPhase({
            runtime: args.runtime,
          }),
      });
      await setPhase(
        args.runtime,
        reenterExecution ? "execution" : "integration",
      );
      continue;
    }

    if (phase === "integration") {
      const result = await runPhaseWithHooks({
        runtime: args.runtime,
        phase,
        run: async () => await runIntegrationPhase({ runtime: args.runtime }),
      });
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
      await runPhaseWithHooks({
        runtime: args.runtime,
        phase,
        run: async () => {
          await runFinalizePhase({ runtime: args.runtime });
        },
      });
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
