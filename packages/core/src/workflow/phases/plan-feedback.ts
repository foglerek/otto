import type { OttoWorkflowRuntime } from "../runtime.js";
import { getTechLeadSystemReminder } from "../system-reminders.js";
import { getPlanFilePath } from "../paths.js";
import { sessionMicroRetry } from "../micro-retry.js";
import { hasOkSentinel } from "../sentinels.js";

async function maybeRetry(
  runtime: OttoWorkflowRuntime,
  label: string,
): Promise<boolean> {
  const wf = runtime.state.workflow;
  const tries = wf?.autoRetryCounts?.[label] ?? 0;
  const maxAuto = 2;
  if (tries < maxAuto) {
    if (wf) {
      wf.autoRetryCounts = wf.autoRetryCounts ?? {};
      wf.autoRetryCounts[label] = tries + 1;
      await runtime.stateStore.save();
    }
    return true;
  }
  return await runtime.prompt.confirm(`${label} failed. Retry?`, {
    defaultValue: true,
  });
}

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
      if (args.runtime.state.workflow) {
        delete args.runtime.state.workflow.techLeadSessionId;
        await args.runtime.stateStore.save();
      }
      sessionId = undefined;
      result = await runOnce(undefined);
    }

    if (!result.success) {
      const retry = await maybeRetry(args.runtime, "Plan feedback");
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
        const retry = await maybeRetry(args.runtime, "Plan feedback");
        if (!retry) {
          throw new Error("Plan feedback missing <OK> sentinel.");
        }
        continue;
      }
    }

    if (args.runtime.state.workflow) {
      args.runtime.state.workflow.techLeadSessionId = result.sessionId;
      await args.runtime.stateStore.save();
    }

    return;
  }
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
