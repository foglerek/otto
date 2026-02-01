import type { OttoWorkflowRuntime } from "../runtime.js";
import { getTechLeadSystemReminder } from "../system-reminders.js";
import { getPlanFilePath } from "../paths.js";

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

    const prompt = [
      getTechLeadSystemReminder(args.runtime, "planning"),
      "<INSTRUCTIONS>",
      `Update ${planFilePath} based on user feedback in <INPUT>.`,
      "Reply <OK> when done.",
      "</INSTRUCTIONS>",
      "<INPUT>",
      feedback,
      "</INPUT>",
    ].join("\n");

    while (true) {
      const result = await args.runtime.runners.lead.run({
        role: "lead",
        phaseName: "plan-feedback",
        prompt,
        cwd: args.runtime.state.worktree.worktreePath,
        exec: args.runtime.exec,
        sessionId: args.runtime.state.workflow?.techLeadSessionId,
        timeoutMs: 10 * 60_000,
      });

      if (!result.success) {
        const retry = await maybeRetry(args.runtime, "Plan feedback");
        if (!retry) {
          throw new Error(result.error ?? "Plan feedback failed.");
        }
        continue;
      }

      if (args.runtime.state.workflow) {
        args.runtime.state.workflow.techLeadSessionId = result.sessionId;
        await args.runtime.stateStore.save();
      }
      break;
    }
  }
}
