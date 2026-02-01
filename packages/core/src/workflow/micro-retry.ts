import type { OttoWorkflowRuntime } from "./runtime.js";
import { getTechLeadSystemReminder } from "./system-reminders.js";

export async function techLeadMicroRetry(args: {
  runtime: OttoWorkflowRuntime;
  message: string;
  timeoutMs?: number;
}): Promise<void> {
  const wf = args.runtime.state.workflow;
  const sessionId = wf?.techLeadSessionId;

  const prompt = [
    getTechLeadSystemReminder(args.runtime, "planning"),
    "",
    "<INSTRUCTIONS>",
    args.message.trim(),
    "",
    "Reply with <OK> only when you have completed the above.",
    "</INSTRUCTIONS>",
    "",
  ].join("\n");

  const result = await args.runtime.runners.lead.run({
    role: "lead",
    phaseName: "session-micro-retry",
    prompt,
    cwd: args.runtime.state.worktree.worktreePath,
    exec: args.runtime.exec,
    sessionId: typeof sessionId === "string" ? sessionId : undefined,
    timeoutMs: args.timeoutMs ?? 60_000,
  });

  if (!result.success) {
    throw new Error(result.error ?? "Tech lead micro-retry failed.");
  }

  if (args.runtime.state.workflow) {
    args.runtime.state.workflow.techLeadSessionId = result.sessionId;
    await args.runtime.stateStore.save();
  }
}
