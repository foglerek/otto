import path from "node:path";
import fs from "node:fs/promises";

import type { OttoWorkflowRuntime } from "../runtime.js";
import { getTechLeadSystemReminder } from "../system-reminders.js";
import { fileExistsAndHasContent } from "../file-utils.js";
import { getRunDir } from "../paths.js";
import { createTaskQueue } from "../task-queue.js";

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

export async function runUserFeedbackPhase(args: {
  runtime: OttoWorkflowRuntime;
}): Promise<{ reenterExecution: boolean }> {
  const runDir = getRunDir(args.runtime.state);
  const queue = createTaskQueue(args.runtime);

  const feedback = await args.runtime.prompt.text(
    "Any additional feedback or tasks? (empty to continue)",
    { defaultValue: "" },
  );

  if (!feedback.trim()) {
    return { reenterExecution: false };
  }

  const nextTaskNumber = queue.getNextTaskNumber(runDir);
  const additionalTaskFilePath = path.join(
    runDir,
    `task-${nextTaskNumber}-additional-user-feedback.md`,
  );

  const prompt = [
    getTechLeadSystemReminder(args.runtime, "planning"),
    "<INSTRUCTIONS>",
    `Create task \`${additionalTaskFilePath}\` based on user feedback in <INPUT>. Follow the existing task format and include acceptance criteria.`,
    "Reply <OK> when done.",
    "</INSTRUCTIONS>",
    "<INPUT>",
    feedback.trim(),
    "</INPUT>",
    "<OUTPUT>",
    additionalTaskFilePath,
    "</OUTPUT>",
    "<system-reminder>Use the exact paths given to you to read and write the input and output files.</system-reminder>",
  ].join("\n");

  while (true) {
    const result = await args.runtime.runners.lead.run({
      role: "lead",
      phaseName: "user-feedback",
      prompt,
      cwd: args.runtime.state.worktree.worktreePath,
      exec: args.runtime.exec,
      sessionId: args.runtime.state.workflow?.techLeadSessionId,
      timeoutMs: 10 * 60_000,
    });

    if (!result.success) {
      const retry = await maybeRetry(args.runtime, "User feedback task");
      if (!retry) {
        throw new Error(result.error ?? "User feedback task creation failed.");
      }
      continue;
    }

    if (args.runtime.state.workflow) {
      args.runtime.state.workflow.techLeadSessionId = result.sessionId;
      await args.runtime.stateStore.save();
    }

    if (!fileExistsAndHasContent(additionalTaskFilePath)) {
      await fs.unlink(additionalTaskFilePath).catch(() => undefined);
      const retry = await maybeRetry(args.runtime, "User feedback task");
      if (!retry) {
        throw new Error(
          `User feedback task file missing or empty: ${additionalTaskFilePath}`,
        );
      }
      continue;
    }

    await queue.addTaskToFront(additionalTaskFilePath);
    return { reenterExecution: true };
  }
}
