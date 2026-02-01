import path from "node:path";
import fs from "node:fs/promises";

import type { OttoWorkflowRuntime } from "../runtime.js";
import { getTechLeadSystemReminder } from "../system-reminders.js";
import { fileExistsAndHasContent } from "../file-utils.js";
import { getRunDir } from "../paths.js";
import { createTaskQueue } from "../task-queue.js";

export type IntegrationRemediationType =
  | "merge-conflict"
  | "quality-check"
  | "integration-tests"
  | "fe-prune";

const typeToSlug: Record<IntegrationRemediationType, string> = {
  "merge-conflict": "integration-merge-conflicts",
  "quality-check": "quality-check-remediation",
  "integration-tests": "integration-tests-remediation",
  "fe-prune": "fe-prune-remediation",
};

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

function buildTaskPrompt(args: {
  runtime: OttoWorkflowRuntime;
  taskFilePath: string;
  type: IntegrationRemediationType;
  failureSummary: string;
}): string {
  const typeLine = `Type: ${args.type}`;
  const guidance =
    args.type === "merge-conflict"
      ? [
          "- Resolve merge conflicts.",
          "- Stage resolved files: git add -A",
          "- Do NOT abort or commit; leave the merge in progress.",
          "- Rerun the integration phase after conflicts are staged.",
        ].join("\n")
      : args.type === "quality-check"
        ? [
            "- Fix the failing quality gate checks.",
            "- Rerun `bun run lint && bun run typecheck && bun run test` (or repo equivalents) if available.",
          ].join("\n")
        : ["- Fix the issue and rerun integration safeguards."].join("\n");

  return [
    getTechLeadSystemReminder(args.runtime, "planning"),
    "<INSTRUCTIONS>",
    `Create the task file \`${args.taskFilePath}\` describing the remediation work required to unblock integration.`,
    "Follow the existing task format and include acceptance criteria.",
    "Reply <OK> when done.",
    "</INSTRUCTIONS>",
    "<INPUT>",
    typeLine,
    "",
    "Failure summary:",
    args.failureSummary.trim(),
    "",
    "Guidance:",
    guidance,
    "</INPUT>",
    "<OUTPUT>",
    args.taskFilePath,
    "</OUTPUT>",
    "<system-reminder>Use the exact paths given to you to read and write the input and output files.</system-reminder>",
  ].join("\n");
}

export async function createIntegrationRemediationTask(args: {
  runtime: OttoWorkflowRuntime;
  type: IntegrationRemediationType;
  failureSummary: string;
}): Promise<{ created: boolean; taskFilePath?: string }> {
  const runDir = getRunDir(args.runtime.state);
  const queue = createTaskQueue(args.runtime);
  const nextTaskNumber = queue.getNextTaskNumber(runDir);
  const slug = typeToSlug[args.type];
  const taskFilePath = path.join(runDir, `task-${nextTaskNumber}-${slug}.md`);

  const prompt = buildTaskPrompt({
    runtime: args.runtime,
    taskFilePath,
    type: args.type,
    failureSummary: args.failureSummary,
  });

  while (true) {
    const result = await args.runtime.runners.lead.run({
      role: "lead",
      phaseName: "integration-remediation-task",
      prompt,
      cwd: args.runtime.state.worktree.worktreePath,
      exec: args.runtime.exec,
      sessionId: args.runtime.state.workflow?.techLeadSessionId,
      timeoutMs: 10 * 60_000,
    });

    if (!result.success) {
      const retry = await maybeRetry(
        args.runtime,
        "Integration remediation task",
      );
      if (!retry) {
        return { created: false };
      }
      continue;
    }

    if (args.runtime.state.workflow) {
      args.runtime.state.workflow.techLeadSessionId = result.sessionId;
      await args.runtime.stateStore.save();
    }

    if (!fileExistsAndHasContent(taskFilePath)) {
      await fs.unlink(taskFilePath).catch(() => undefined);
      const retry = await maybeRetry(
        args.runtime,
        "Integration remediation task",
      );
      if (!retry) {
        return { created: false };
      }
      continue;
    }

    await queue.addTaskToFront(taskFilePath);
    return { created: true, taskFilePath };
  }
}
