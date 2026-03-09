import type { OttoWorkflowRuntime } from "../runtime.js";
import { getTechLeadSystemReminder } from "../system-reminders.js";
import { fileExistsAndHasContent } from "../file-utils.js";
import { getPlanFilePath, toWorktreePath } from "../paths.js";
import { sessionMicroRetry } from "../micro-retry.js";
import { hasOkSentinel } from "../sentinels.js";
import { maybeAutoRetry } from "../retry-policy.js";
import { dispatchWorkflowAction } from "../state-reducer.js";

async function applyPlanFeedbackUpdate(args: {
  runtime: OttoWorkflowRuntime;
  planFilePath: string;
  feedback: string;
}): Promise<void> {
  const prompt = [
    getTechLeadSystemReminder(args.runtime, "planning"),
    "<INSTRUCTIONS>",
    `Update ${args.planFilePath} based on user feedback in <INPUT>.`,
    "Reply <OK> when done.",
    "</INSTRUCTIONS>",
    "<INPUT>",
    args.feedback,
    "</INPUT>",
  ].join("\n");

  while (true) {
    const runOnce = async (sessionId?: string) =>
      await args.runtime.runners.lead.run({
        role: "lead",
        phaseName: "plan-feedback",
        prompt,
        cwd: args.runtime.state.worktree.worktreePath,
        exec: args.runtime.exec,
        sessionId,
        timeoutMs: 10 * 60_000,
      });

    let sessionId = args.runtime.state.workflow?.techLeadSessionId;
    let result = await runOnce(sessionId);
    if (sessionId && result.contextOverflow) {
      await dispatchWorkflowAction(args.runtime.stateStore, {
        type: "set-tech-lead-session",
        sessionId: null,
        defaultPhase: "plan-feedback",
      });
      sessionId = undefined;
      result = await runOnce(undefined);
    }

    if (!result.success) {
      const retry = await maybeAutoRetry({
        runtime: args.runtime,
        label: "Plan feedback",
        defaultPhase: "plan-feedback",
      });
      if (!retry) {
        throw new Error(result.error ?? "Plan feedback failed.");
      }
      continue;
    }

    if (!hasOkSentinel(result.outputText)) {
      const ok = await sessionMicroRetry({
        runtime: args.runtime,
        role: "lead",
        sessionId: result.sessionId ?? sessionId ?? null,
        message: "Reply with <OK> only when the plan update is complete.",
      });
      if (!ok) {
        const retry = await maybeAutoRetry({
          runtime: args.runtime,
          label: "Plan feedback",
          defaultPhase: "plan-feedback",
        });
        if (!retry) {
          throw new Error("Plan feedback missing <OK> sentinel.");
        }
        continue;
      }
    }

    const planOk = await ensurePlanInMainRepo({
      runtime: args.runtime,
      planFilePath: args.planFilePath,
      sessionIdForRetry: result.sessionId ?? sessionId ?? null,
    });
    if (!planOk) {
      const retry = await maybeAutoRetry({
        runtime: args.runtime,
        label: "Plan feedback",
        defaultPhase: "plan-feedback",
      });
      if (!retry) {
        throw new Error("Plan feedback missing updated plan file.");
      }
      continue;
    }

    await dispatchWorkflowAction(args.runtime.stateStore, {
      type: "set-tech-lead-session",
      sessionId: result.sessionId ?? null,
      defaultPhase: "plan-feedback",
    });

    return;
  }
}

async function ensurePlanInMainRepo(args: {
  runtime: OttoWorkflowRuntime;
  planFilePath: string;
  sessionIdForRetry: string | null;
}): Promise<boolean> {
  if (fileExistsAndHasContent(args.planFilePath)) return true;
  const worktreePlanPath = toWorktreePath({
    state: args.runtime.state,
    mainRepoFilePath: args.planFilePath,
  });
  if (worktreePlanPath && fileExistsAndHasContent(worktreePlanPath)) {
    args.runtime.reminders.techLead.push(
      `You wrote Otto artifacts under the worktree. Create/update the file at: ${args.planFilePath}`,
    );
    const ok = await sessionMicroRetry({
      runtime: args.runtime,
      role: "lead",
      sessionId: args.sessionIdForRetry,
      message: `Move or recreate the plan at ${args.planFilePath} and reply with <OK>.`,
    });
    return ok && fileExistsAndHasContent(args.planFilePath);
  }
  return false;
}

export async function runPlanFeedbackPhase(args: {
  runtime: OttoWorkflowRuntime;
}): Promise<void> {
  const planFilePath = getPlanFilePath(args.runtime.state);

  while (true) {
    const feedback = await args.runtime.prompt.text(
      `Plan feedback? (empty to continue)\nPlan: ${planFilePath}`,
      { defaultValue: "" },
    );

    if (!feedback.trim()) return;

    await applyPlanFeedbackUpdate({
      runtime: args.runtime,
      planFilePath,
      feedback,
    });
  }
}
