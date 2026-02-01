import fs from "node:fs";

import type { OttoWorkflowRuntime } from "../runtime.js";
import { getTechLeadSystemReminder } from "../system-reminders.js";
import { getRunDir, toWorktreePath } from "../paths.js";
import { sessionMicroRetry } from "../micro-retry.js";

function directoryHasTaskFiles(directory: string): boolean {
  try {
    if (!fs.existsSync(directory)) return false;
    const entries = fs.readdirSync(directory);
    return entries.some((entry) => /^task-\d+-.+\.md$/i.test(entry));
  } catch {
    return false;
  }
}

export async function runTaskSplittingPhase(args: {
  runtime: OttoWorkflowRuntime;
}): Promise<void> {
  const runDir = getRunDir(args.runtime.state);
  const taskSplitPrompt = [
    getTechLeadSystemReminder(args.runtime, "task-splitting"),
    "<INSTRUCTIONS>",
    `Create detailed tasks in ${runDir} following \`task-<N>-<desc>.md\`.`,
    "Each task should be appropriate for one agent session, be atomic, and include acceptance criteria.",
    "Do NOT create tasks whose sole purpose is to run lint/typecheck/test/format/coverage. Those are handled by the workflow.",
    "Database state is ephemeral between tasks; persistent changes require migrations/seed changes.",
    "Consider whether an integration test task is needed.",
    "Reply <OK> when done.",
    "</INSTRUCTIONS>",
    "<system-reminder>Use the exact paths given to you to read and write the input and output files.</system-reminder>",
  ].join("\n");

  while (true) {
    const result = await args.runtime.runners.lead.run({
      role: "lead",
      phaseName: "task-splitting",
      prompt: taskSplitPrompt,
      cwd: args.runtime.state.worktree.worktreePath,
      exec: args.runtime.exec,
      sessionId: args.runtime.state.workflow?.techLeadSessionId,
      timeoutMs: 10 * 60_000,
    });

    if (!result.success) {
      const retry = await args.runtime.prompt.confirm(
        "Task splitting failed. Retry?",
        { defaultValue: true },
      );
      if (!retry) throw new Error(result.error ?? "Task splitting failed.");
      continue;
    }

    if (args.runtime.state.workflow) {
      args.runtime.state.workflow.techLeadSessionId = result.sessionId;
      await args.runtime.stateStore.save();
    }

    if (directoryHasTaskFiles(runDir)) {
      return;
    }

    const worktreeRunDir = toWorktreePath({
      state: args.runtime.state,
      mainRepoFilePath: runDir,
    });
    if (worktreeRunDir && directoryHasTaskFiles(worktreeRunDir)) {
      args.runtime.reminders.techLead.push(
        `Task files must be written to ${runDir}. You wrote them under the worktree. Move or recreate them at the main repo path.`,
      );
      const ok = await sessionMicroRetry({
        runtime: args.runtime,
        role: "lead",
        sessionId: args.runtime.state.workflow?.techLeadSessionId ?? null,
        message: `Move or recreate your task files at ${runDir} (absolute path) and reply with <OK>.`,
      });
      if (ok && directoryHasTaskFiles(runDir)) {
        return;
      }
    }

    const retryMissing = await args.runtime.prompt.confirm(
      "Task files missing from main repo run dir. Retry task splitting?",
      { defaultValue: true },
    );
    if (!retryMissing) {
      throw new Error(`Task files missing from ${runDir}`);
    }
  }
}
