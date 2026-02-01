import type { OttoWorkflowRuntime } from "../runtime.js";
import { getTechLeadSystemReminder } from "../system-reminders.js";
import { fileExistsAndHasContent } from "../file-utils.js";
import { sessionMicroRetry } from "../micro-retry.js";
import {
  getAttemptsRemaining,
  getBaseTaskInfo,
  DEFAULT_MAX_REMEDIATION_ATTEMPTS,
} from "../task-metadata.js";
import { outcomeFilePath, remediationTaskFilePath } from "../task-artifacts.js";

export type DecisionResult = {
  acceptanceDecision: "acceptance" | "remediation" | "failed";
  acceptanceOutput: string;
};

export type TaskResult = {
  reportFilePath: string;
  reviewFilePath: string;
  reportSummaryContent?: string;
  reviewSummaryContent?: string;
  fullReportFilePath?: string;
};

type DecisionContext = {
  baseTaskPath: string;
  baseTaskName: string;
  canCreateRemediation: boolean;
  remainingRemediations: number;
  remediationPath: string;
  outcomePath: string;
  allowed: Array<DecisionResult["acceptanceDecision"]>;
};

function hasDecisionTag(
  text: string,
  allowed: Array<DecisionResult["acceptanceDecision"]>,
): DecisionResult["acceptanceDecision"] | null {
  const re = new RegExp(
    `<DECISION>\\s*(${allowed.join("|")})\\s*<\\/DECISION>`,
    "i",
  );
  const match = text.match(re);
  if (!match) return null;
  const value = match[1]?.toLowerCase();
  if (value === "acceptance" || value === "remediation" || value === "failed") {
    return value;
  }
  return null;
}

function formatSummaryBlock(tag: string, content: string | undefined): string {
  const trimmed = content?.trim();
  if (!trimmed) return "";
  return `<${tag}>\n${trimmed}\n</${tag}>`;
}

function getAllowedDecisions(
  canCreateRemediation: boolean,
): Array<DecisionResult["acceptanceDecision"]> {
  return canCreateRemediation
    ? ["remediation", "acceptance"]
    : ["failed", "acceptance"];
}

function buildDecisionContext(
  runtime: OttoWorkflowRuntime,
  taskFile: string,
): DecisionContext {
  const {
    baseTaskPath,
    baseTaskName,
    attempt: currentAttempt,
  } = getBaseTaskInfo(taskFile);
  const remainingRemediations = getAttemptsRemaining(
    currentAttempt,
    DEFAULT_MAX_REMEDIATION_ATTEMPTS,
  );
  const canCreateRemediation = remainingRemediations > 0;
  const nextAttempt = currentAttempt + 1;

  const remediationPath = remediationTaskFilePath({
    state: runtime.state,
    baseTaskName,
    attempt: nextAttempt,
  });
  const outcomePath = outcomeFilePath(runtime.state, taskFile);
  const allowed = getAllowedDecisions(canCreateRemediation);
  return {
    baseTaskPath,
    baseTaskName,
    canCreateRemediation,
    remainingRemediations,
    remediationPath,
    outcomePath,
    allowed,
  };
}

function buildDecisionPrompt(args: {
  runtime: OttoWorkflowRuntime;
  taskFile: string;
  taskResult: TaskResult;
  ctx: DecisionContext;
}): string {
  const reminder =
    getTechLeadSystemReminder(args.runtime, "review") +
    `\n\n${args.ctx.canCreateRemediation ? `You have ${args.ctx.remainingRemediations} remediation attempt(s) remaining.` : "Remediation limit reached."}`;

  const rejectLine = args.ctx.canCreateRemediation
    ? `Create remediation → \`${args.ctx.remediationPath}\` → reply "<DECISION>remediation</DECISION>"`
    : 'Reply "<DECISION>failed</DECISION>" to discard pending work and restart from the original task';

  const outputGuidance = args.ctx.canCreateRemediation
    ? [
        "- If you do not accept the changes:",
        `  - Create a remediation task and save it to \`${args.ctx.remediationPath}\`.`,
        '  - Reply with "<DECISION>remediation</DECISION>" ONLY.',
        "- If you accept the changes:",
        `  - Write a brief outcome summary to \`${args.ctx.outcomePath}\`.`,
        '  - Reply with "<DECISION>acceptance</DECISION>" ONLY.',
      ].join("\n")
    : [
        "- If you do not accept the changes:",
        '  - Reply with "<DECISION>failed</DECISION>" ONLY.',
        "- If you accept the changes:",
        `  - Write a brief outcome summary to \`${args.ctx.outcomePath}\`.`,
        '  - Reply with "<DECISION>acceptance</DECISION>" ONLY.',
      ].join("\n");

  return [
    reminder,
    "<INSTRUCTIONS>",
    "Review the task against your acceptance criteria.",
    "Inputs: task, report, review.",
    "Reference at least one bullet from BOTH summaries when justifying your decision.",
    `Reject: ${rejectLine}`,
    `Accept: write outcome → \`${args.ctx.outcomePath}\` → reply "<DECISION>acceptance</DECISION>"`,
    "</INSTRUCTIONS>",
    formatSummaryBlock("REPORT_SUMMARY", args.taskResult.reportSummaryContent),
    formatSummaryBlock("REVIEW_SUMMARY", args.taskResult.reviewSummaryContent),
    "<INPUT_TASK>",
    args.taskFile,
    "</INPUT_TASK>",
    "<INPUT_REPORT>",
    args.taskResult.reportFilePath,
    "</INPUT_REPORT>",
    "<INPUT_REVIEW>",
    args.taskResult.reviewFilePath,
    "</INPUT_REVIEW>",
    "<OUTPUT>",
    outputGuidance,
    "</OUTPUT>",
  ]
    .filter(Boolean)
    .join("\n");
}

async function ensureDecisionFile(args: {
  runtime: OttoWorkflowRuntime;
  decision: DecisionResult["acceptanceDecision"];
  ctx: DecisionContext;
}): Promise<boolean> {
  const wf = args.runtime.state.workflow;
  const sessionId = wf?.techLeadSessionId ?? null;

  if (args.decision === "acceptance") {
    if (fileExistsAndHasContent(args.ctx.outcomePath)) return true;
    await sessionMicroRetry({
      runtime: args.runtime,
      role: "lead",
      sessionId,
      message: `Create the outcome file: ${args.ctx.outcomePath}`,
    });
    return fileExistsAndHasContent(args.ctx.outcomePath);
  }

  if (args.decision === "remediation") {
    if (fileExistsAndHasContent(args.ctx.remediationPath)) return true;
    await sessionMicroRetry({
      runtime: args.runtime,
      role: "lead",
      sessionId,
      message: `Create the remediation file: ${args.ctx.remediationPath}`,
    });
    return fileExistsAndHasContent(args.ctx.remediationPath);
  }

  return true;
}

function resolveAcceptanceOutput(
  decision: DecisionResult["acceptanceDecision"],
  ctx: DecisionContext,
): string {
  if (decision === "remediation") return ctx.remediationPath;
  if (decision === "acceptance") return ctx.outcomePath;
  return ctx.baseTaskPath;
}

export async function executeTechLeadDecision(args: {
  runtime: OttoWorkflowRuntime;
  taskFile: string;
  taskResult: TaskResult;
}): Promise<DecisionResult | null> {
  const ctx = buildDecisionContext(args.runtime, args.taskFile);
  const prompt = buildDecisionPrompt({
    runtime: args.runtime,
    taskFile: args.taskFile,
    taskResult: args.taskResult,
    ctx,
  });

  const result = await args.runtime.runners.lead.run({
    role: "lead",
    phaseName: "tech-lead-decision",
    prompt,
    cwd: args.runtime.state.worktree.worktreePath,
    exec: args.runtime.exec,
    sessionId: args.runtime.state.workflow?.techLeadSessionId,
    timeoutMs: 10 * 60_000,
  });

  if (!result.success) return null;

  if (args.runtime.state.workflow) {
    args.runtime.state.workflow.techLeadSessionId = result.sessionId;
    await args.runtime.stateStore.save();
  }

  const decision = hasDecisionTag(result.outputText ?? "", ctx.allowed);
  if (!decision) {
    const replyWith = ctx.allowed
      .map((d) => `<DECISION>${d}</DECISION>`)
      .join(" OR ");
    await sessionMicroRetry({
      runtime: args.runtime,
      role: "lead",
      sessionId: args.runtime.state.workflow?.techLeadSessionId ?? null,
      message: "Provide your decision tag.",
      replyWith,
    });
    return null;
  }

  const ok = await ensureDecisionFile({
    runtime: args.runtime,
    decision,
    ctx,
  });
  if (!ok) return null;

  return {
    acceptanceDecision: decision,
    acceptanceOutput: resolveAcceptanceOutput(decision, ctx),
  };
}
