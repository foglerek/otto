import fs from "node:fs/promises";

import type { OttoWorkflowRuntime } from "../runtime.js";
import { getTaskAgentSystemReminder } from "../system-reminders.js";
import { fileExistsAndHasContent } from "../file-utils.js";
import { toWorktreePath } from "../paths.js";
import { sessionMicroRetry } from "../micro-retry.js";
import { reportFilePath } from "../task-artifacts.js";
import { getBaseTaskInfo } from "../task-metadata.js";

export type TaskExecutionResult = {
  reportFilePath: string;
  sessionId: string | null;
};

function buildTaskExecutionPrompt(
  runtime: OttoWorkflowRuntime,
  taskFile: string,
) {
  return [
    getTaskAgentSystemReminder(runtime),
    "<INSTRUCTIONS>",
    "You are responsible for implementing the task in <INPUT_TASK>.",
    "ALWAYS read AGENTS.md before planning or work.",
    "Once you are satisfied with your implementation, reply with <OK> ONLY.",
    "</INSTRUCTIONS>",
    "<INPUT_TASK>",
    taskFile,
    "</INPUT_TASK>",
  ].join("\n");
}

function buildTaskReportPrompt(
  runtime: OttoWorkflowRuntime,
  args: {
    taskFile: string;
    reportPath: string;
  },
): string {
  return [
    getTaskAgentSystemReminder(runtime),
    "<INSTRUCTIONS>",
    "Write a task report for the tech lead.",
    `Create \`${args.reportPath}\` using these headings:`,
    "1. ## Problems & Risks",
    "2. ## Work Completed",
    "3. ## Next Steps / Requests",
    "Keep it concise and bias toward risks.",
    "Reply with <OK> when done.",
    "</INSTRUCTIONS>",
    "<INPUT_TASK>",
    args.taskFile,
    "</INPUT_TASK>",
    "<OUTPUT>",
    args.reportPath,
    "</OUTPUT>",
    "<system-reminder>Use the exact paths given to you to read and write the input and output files.</system-reminder>",
  ].join("\n");
}

async function ensureOkOrMicroRetry(args: {
  runtime: OttoWorkflowRuntime;
  role: "task";
  sessionId: string | null;
  outputText: string;
}): Promise<boolean> {
  if (args.outputText.trim().endsWith("<OK>")) return true;

  return await sessionMicroRetry({
    runtime: args.runtime,
    role: args.role,
    sessionId: args.sessionId,
    message: "If you are done, reply with <OK>.",
  });
}

async function clearPersistedTaskSession(args: {
  runtime: OttoWorkflowRuntime;
  sessionKey: string;
}): Promise<void> {
  const wf = args.runtime.state.workflow;
  if (!wf?.taskAgentSessions) return;
  wf.taskAgentSessions[args.sessionKey] = null;
  await args.runtime.stateStore.save();
}

async function persistTaskSession(args: {
  runtime: OttoWorkflowRuntime;
  sessionKey: string;
  sessionId: string | null;
}): Promise<void> {
  const wf = args.runtime.state.workflow;
  if (!wf?.taskAgentSessions) return;
  wf.taskAgentSessions[args.sessionKey] = args.sessionId;
  await args.runtime.stateStore.save();
}

async function runTaskExecution(args: {
  runtime: OttoWorkflowRuntime;
  taskFile: string;
  sessionKey: string;
  initialSessionId: string | null;
}): Promise<string | null> {
  const prompt = buildTaskExecutionPrompt(args.runtime, args.taskFile);

  const runOnce = async (sessionId: string | null) =>
    await args.runtime.runners.task.run({
      role: "task",
      phaseName: "task-execution",
      prompt,
      cwd: args.runtime.state.worktree.worktreePath,
      exec: args.runtime.exec,
      sessionId: sessionId ?? undefined,
      timeoutMs: 25 * 60_000,
    });

  let sessionId = args.initialSessionId;
  let result = await runOnce(sessionId);
  if (sessionId && result.contextOverflow) {
    await clearPersistedTaskSession({
      runtime: args.runtime,
      sessionKey: args.sessionKey,
    });
    sessionId = null;
    result = await runOnce(null);
  }

  if (!result.success) return null;

  sessionId = result.sessionId ?? sessionId;
  const ok = await ensureOkOrMicroRetry({
    runtime: args.runtime,
    role: "task",
    sessionId,
    outputText: result.outputText ?? "",
  });
  if (!ok) return null;

  await persistTaskSession({
    runtime: args.runtime,
    sessionKey: args.sessionKey,
    sessionId,
  });

  return sessionId;
}

async function ensureReportExists(args: {
  runtime: OttoWorkflowRuntime;
  reportPath: string;
  sessionId: string | null;
}): Promise<boolean> {
  if (fileExistsAndHasContent(args.reportPath)) return true;

  const worktreeReportPath = toWorktreePath({
    state: args.runtime.state,
    mainRepoFilePath: args.reportPath,
  });

  if (
    worktreeReportPath &&
    fileExistsAndHasContent(worktreeReportPath) &&
    !fileExistsAndHasContent(args.reportPath)
  ) {
    args.runtime.reminders.task.push(
      `Write the task report to ${args.reportPath}. Avoid writing artifacts under the worktree .otto.`,
    );
    await sessionMicroRetry({
      runtime: args.runtime,
      role: "task",
      sessionId: args.sessionId,
      message: `Your report must be written to ${args.reportPath}. Recreate it there and reply with <OK>.`,
    });
  }

  if (!fileExistsAndHasContent(args.reportPath)) {
    await sessionMicroRetry({
      runtime: args.runtime,
      role: "task",
      sessionId: args.sessionId,
      message: `Create the report file: ${args.reportPath}`,
    });
  }

  return fileExistsAndHasContent(args.reportPath);
}

async function runTaskReport(args: {
  runtime: OttoWorkflowRuntime;
  taskFile: string;
  reportPath: string;
  sessionId: string | null;
}): Promise<boolean> {
  const prompt = buildTaskReportPrompt(args.runtime, {
    taskFile: args.taskFile,
    reportPath: args.reportPath,
  });

  const result = await args.runtime.runners.task.run({
    role: "task",
    phaseName: "task-report",
    prompt,
    cwd: args.runtime.state.worktree.worktreePath,
    exec: args.runtime.exec,
    sessionId: args.sessionId ?? undefined,
    timeoutMs: 5 * 60_000,
  });

  const ok = result.success
    ? await ensureOkOrMicroRetry({
        runtime: args.runtime,
        role: "task",
        sessionId: result.sessionId ?? args.sessionId,
        outputText: result.outputText ?? "",
      })
    : false;

  if (!ok) return false;

  const exists = await ensureReportExists({
    runtime: args.runtime,
    reportPath: args.reportPath,
    sessionId: result.sessionId ?? args.sessionId,
  });
  if (!exists) return false;

  const contents = await fs.readFile(args.reportPath, "utf8");
  return Boolean(contents.trim());
}

export async function executeTask(
  runtime: OttoWorkflowRuntime,
  taskFile: string,
): Promise<TaskExecutionResult | null> {
  const reportPath = reportFilePath(runtime.state, taskFile);
  if (fileExistsAndHasContent(reportPath)) {
    return { reportFilePath: reportPath, sessionId: null };
  }

  const sessionKey = getBaseTaskInfo(taskFile).baseTaskPath;
  const persisted =
    runtime.state.workflow?.taskAgentSessions?.[sessionKey] ?? null;
  const sessionId = await runTaskExecution({
    runtime,
    taskFile,
    sessionKey,
    initialSessionId: persisted,
  });
  if (sessionId === null && !runtime.state.workflow?.taskAgentSessions) {
    // No session persistence available; continue anyway.
  }
  if (sessionId === null && !fileExistsAndHasContent(reportPath)) {
    // Keep going; report generation can still succeed without a session.
  }

  const reportOk = await runTaskReport({
    runtime,
    taskFile,
    reportPath,
    sessionId,
  });
  if (!reportOk) return null;

  return { reportFilePath: reportPath, sessionId };
}
