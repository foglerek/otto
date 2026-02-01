import path from "node:path";

import type { OttoWorkflowRuntime } from "../runtime.js";
import { getTechLeadSystemReminder } from "../system-reminders.js";
import { getPlanFilePath, getRunDir } from "../paths.js";
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

async function applyTaskFeedbackUpdate(args: {
  runtime: OttoWorkflowRuntime;
  prompt: string;
}): Promise<void> {
  while (true) {
    const runOnce = async (sessionId?: string) =>
      await args.runtime.runners.lead.run({
        role: "lead",
        phaseName: "task-feedback",
        prompt: args.prompt,
        cwd: args.runtime.state.worktree.worktreePath,
        exec: args.runtime.exec,
        sessionId,
        timeoutMs: 15 * 60_000,
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
      const retry = await maybeRetry(args.runtime, "Task feedback");
      if (!retry) {
        throw new Error(result.error ?? "Task feedback failed.");
      }
      continue;
    }

    if (!hasOkSentinel(result.outputText)) {
      const ok = await sessionMicroRetry({
        runtime: args.runtime,
        role: "lead",
        sessionId: result.sessionId ?? sessionId ?? null,
        message:
          "Reply with <OK> only when the task feedback updates are complete.",
      });
      if (!ok) {
        const retry = await maybeRetry(args.runtime, "Task feedback");
        if (!retry) {
          throw new Error("Task feedback missing <OK> sentinel.");
        }
        continue;
      }
    }

    if (args.runtime.state.workflow) {
      args.runtime.state.workflow.techLeadSessionId = result.sessionId;
      args.runtime.state.workflow.taskQueue = [];
      await args.runtime.stateStore.save();
    }

    return;
  }
}

export async function runTaskFeedbackPhase(args: {
  runtime: OttoWorkflowRuntime;
}): Promise<void> {
  const runDir = getRunDir(args.runtime.state);
  const planFilePath = getPlanFilePath(args.runtime.state);
  const taskQueue = createTaskQueue(args.runtime);

  let firstIteration = true;
  while (true) {
    const tasks = await taskQueue.loadTasks({ runDir, ignoreState: false });
    const relativeTasks = tasks.map((t) =>
      path.relative(args.runtime.state.mainRepoPath, t),
    );
    const contextLines = [
      `Plan: ${planFilePath}`,
      ...(relativeTasks.length > 0
        ? ["Tasks:", ...relativeTasks.map((t) => `- ${t}`)]
        : ["Tasks: (none)"]),
    ];

    const feedback = await args.runtime.prompt.text(
      `${firstIteration ? "Task splitting feedback?" : "More task splitting feedback?"} (empty to continue)\n${contextLines.join("\n")}`,
      { defaultValue: "" },
    );

    firstIteration = false;

    if (!feedback.trim()) return;

    const prompt = [
      getTechLeadSystemReminder(args.runtime, "task-splitting"),
      "<INSTRUCTIONS>",
      `Update ${planFilePath} and task files in ${runDir} based on feedback in <INPUT>. Reply <OK> when done.`,
      "</INSTRUCTIONS>",
      "<INPUT>",
      feedback,
      "</INPUT>",
    ].join("\n");

    await applyTaskFeedbackUpdate({ runtime: args.runtime, prompt });
  }
}
