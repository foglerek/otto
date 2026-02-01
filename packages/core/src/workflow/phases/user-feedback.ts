import path from "node:path";
import fs from "node:fs/promises";

import type { OttoWorkflowRuntime } from "../runtime.js";
import { getTechLeadSystemReminder } from "../system-reminders.js";
import { fileExistsAndHasContent } from "../file-utils.js";
import { getRunDir, toWorktreePath } from "../paths.js";
import { createTaskQueue } from "../task-queue.js";
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

function buildUserFeedbackTaskPrompt(args: {
  runtime: OttoWorkflowRuntime;
  taskFilePath: string;
  feedback: string;
}): string {
  return [
    getTechLeadSystemReminder(args.runtime, "planning"),
    "<INSTRUCTIONS>",
    `Create task \`${args.taskFilePath}\` based on user feedback in <INPUT>. Follow the existing task format and include acceptance criteria.`,
    "Reply <OK> when done.",
    "</INSTRUCTIONS>",
    "<INPUT>",
    args.feedback.trim(),
    "</INPUT>",
    "<OUTPUT>",
    args.taskFilePath,
    "</OUTPUT>",
    "<system-reminder>Use the exact paths given to you to read and write the input and output files.</system-reminder>",
  ].join("\n");
}

type LeadRunResult = {
  success: boolean;
  sessionId?: string;
  outputText?: string;
  error?: string;
  contextOverflow?: boolean;
};

async function runLeadWithOverflowHandling(args: {
  runtime: OttoWorkflowRuntime;
  phaseName: string;
  prompt: string;
}): Promise<{ result: LeadRunResult; sessionIdForRetry: string | null }> {
  const initialSessionId = args.runtime.state.workflow?.techLeadSessionId;
  const runOnce = async (sessionId?: string) =>
    (await args.runtime.runners.lead.run({
      role: "lead",
      phaseName: args.phaseName,
      prompt: args.prompt,
      cwd: args.runtime.state.worktree.worktreePath,
      exec: args.runtime.exec,
      sessionId,
      timeoutMs: 10 * 60_000,
    })) as LeadRunResult;

  let result = await runOnce(initialSessionId);
  if (initialSessionId && result.contextOverflow) {
    if (args.runtime.state.workflow) {
      delete args.runtime.state.workflow.techLeadSessionId;
      await args.runtime.stateStore.save();
    }
    result = await runOnce(undefined);
  }

  return {
    result,
    sessionIdForRetry: result.sessionId ?? initialSessionId ?? null,
  };
}

async function ensureOkSentinel(args: {
  runtime: OttoWorkflowRuntime;
  sessionIdForRetry: string | null;
  outputText?: string;
  message: string;
}): Promise<boolean> {
  if (hasOkSentinel(args.outputText)) return true;
  return await sessionMicroRetry({
    runtime: args.runtime,
    role: "lead",
    sessionId: args.sessionIdForRetry,
    message: args.message,
  });
}

async function tryFixWrongDirTaskFile(args: {
  runtime: OttoWorkflowRuntime;
  taskFilePath: string;
}): Promise<boolean> {
  const worktreeTaskFilePath = toWorktreePath({
    state: args.runtime.state,
    mainRepoFilePath: args.taskFilePath,
  });
  if (!worktreeTaskFilePath) return false;
  if (!fileExistsAndHasContent(worktreeTaskFilePath)) return false;

  args.runtime.reminders.techLead.push(
    `You wrote Otto artifacts under the worktree. Create the task at: ${args.taskFilePath}`,
  );
  const ok = await sessionMicroRetry({
    runtime: args.runtime,
    role: "lead",
    sessionId: args.runtime.state.workflow?.techLeadSessionId ?? null,
    message: `Move or recreate the task file at ${args.taskFilePath} and reply with <OK>.`,
  });

  return ok && fileExistsAndHasContent(args.taskFilePath);
}

async function ensureUserFeedbackTaskFile(args: {
  runtime: OttoWorkflowRuntime;
  label: string;
  taskFilePath: string;
  prompt: string;
}): Promise<boolean> {
  while (true) {
    const { result, sessionIdForRetry } = await runLeadWithOverflowHandling({
      runtime: args.runtime,
      phaseName: "user-feedback",
      prompt: args.prompt,
    });

    if (!result.success) {
      const retry = await maybeRetry(args.runtime, args.label);
      if (!retry) return false;
      continue;
    }

    const ok = await ensureOkSentinel({
      runtime: args.runtime,
      sessionIdForRetry,
      outputText: result.outputText,
      message: "Reply with <OK> only when the task file is created.",
    });
    if (!ok) {
      const retry = await maybeRetry(args.runtime, args.label);
      if (!retry) return false;
      continue;
    }

    if (args.runtime.state.workflow) {
      args.runtime.state.workflow.techLeadSessionId = result.sessionId;
      await args.runtime.stateStore.save();
    }

    if (fileExistsAndHasContent(args.taskFilePath)) return true;

    if (
      await tryFixWrongDirTaskFile({
        runtime: args.runtime,
        taskFilePath: args.taskFilePath,
      })
    ) {
      return true;
    }

    await fs.unlink(args.taskFilePath).catch(() => undefined);
    const retry = await maybeRetry(args.runtime, args.label);
    if (!retry) return false;
  }
}

export async function runUserFeedbackPhase(args: {
  runtime: OttoWorkflowRuntime;
}): Promise<{ reenterExecution: boolean }> {
  const feedback = await args.runtime.prompt.text(
    "Any additional feedback or tasks? (empty to continue)",
    { defaultValue: "" },
  );
  if (!feedback.trim()) {
    return { reenterExecution: false };
  }

  const label = "User feedback task";
  const runDir = getRunDir(args.runtime.state);
  const queue = createTaskQueue(args.runtime);
  const nextTaskNumber = queue.getNextTaskNumber(runDir);
  const taskFilePath = path.join(
    runDir,
    `task-${nextTaskNumber}-additional-user-feedback.md`,
  );

  const prompt = buildUserFeedbackTaskPrompt({
    runtime: args.runtime,
    taskFilePath,
    feedback,
  });

  const ok = await ensureUserFeedbackTaskFile({
    runtime: args.runtime,
    label,
    taskFilePath,
    prompt,
  });
  if (!ok) {
    throw new Error("User feedback task creation failed.");
  }

  await queue.addTaskToFront(taskFilePath);
  return { reenterExecution: true };
}
