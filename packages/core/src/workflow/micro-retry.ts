import type { OttoWorkflowRuntime } from "./runtime.js";
import {
  getTaskAgentSystemReminder,
  getTaskReviewerSystemReminder,
  getTechLeadSystemReminder,
} from "./system-reminders.js";

import type { OttoRole } from "@otto/ports";

import { OK_SENTINEL_PATTERN } from "./sentinels.js";

function getReminderForRole(
  runtime: OttoWorkflowRuntime,
  role: OttoRole,
): string {
  if (role === "lead") return getTechLeadSystemReminder(runtime, "planning");
  if (role === "reviewer") return getTaskReviewerSystemReminder(runtime);
  return getTaskAgentSystemReminder(runtime);
}

function getRunnerForRole(runtime: OttoWorkflowRuntime, role: OttoRole) {
  if (role === "lead") return runtime.runners.lead;
  if (role === "reviewer") return runtime.runners.reviewer;
  if (role === "summarize") return runtime.runners.summarize;
  return runtime.runners.task;
}

async function persistLeadSession(
  runtime: OttoWorkflowRuntime,
  sessionId?: string,
) {
  if (!runtime.state.workflow) return;
  if (!sessionId) return;
  runtime.state.workflow.techLeadSessionId = sessionId;
  await runtime.stateStore.save();
}

export async function sessionMicroRetry(args: {
  runtime: OttoWorkflowRuntime;
  message: string;
  sessionId: string | null;
  role: OttoRole;
  timeoutMs?: number;
  replyWith?: string;
  requiredPattern?: RegExp;
}): Promise<boolean> {
  if (!args.sessionId) return false;

  const replyWith = args.replyWith ?? "<OK>";
  const requiredPattern = args.requiredPattern ?? OK_SENTINEL_PATTERN;

  const prompt = [
    getReminderForRole(args.runtime, args.role),
    "",
    "<INSTRUCTIONS>",
    args.message.trim(),
    "",
    `Reply with ${replyWith} only when you have completed the above.`,
    "</INSTRUCTIONS>",
    "",
  ].join("\n");

  const runner = getRunnerForRole(args.runtime, args.role);
  const result = await runner.run({
    role: args.role,
    phaseName: `${args.role}-micro-retry`,
    prompt,
    cwd: args.runtime.state.worktree.worktreePath,
    exec: args.runtime.exec,
    sessionId: args.sessionId ?? undefined,
    timeoutMs: args.timeoutMs ?? 2 * 60_000,
  });

  if (result.success) {
    const output = result.outputText ?? "";
    if (!requiredPattern.test(output)) {
      return false;
    }
    if (args.role === "lead") {
      await persistLeadSession(args.runtime, result.sessionId);
    }
    return true;
  }

  return false;
}

export async function techLeadMicroRetry(args: {
  runtime: OttoWorkflowRuntime;
  message: string;
  timeoutMs?: number;
}): Promise<void> {
  const wf = args.runtime.state.workflow;
  const ok = await sessionMicroRetry({
    runtime: args.runtime,
    message: args.message,
    sessionId: wf?.techLeadSessionId ?? null,
    role: "lead",
    timeoutMs: args.timeoutMs,
  });

  if (!ok) throw new Error("Tech lead micro-retry failed.");
}
