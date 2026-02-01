import fs from "node:fs";

import type { OttoWorkflowRuntime } from "../runtime.js";
import { getTechLeadSystemReminder } from "../system-reminders.js";
import { getRunDir, toWorktreePath } from "../paths.js";
import { sessionMicroRetry } from "../micro-retry.js";
import { hasOkSentinel } from "../sentinels.js";

function directoryHasTaskFiles(directory: string): boolean {
  try {
    if (!fs.existsSync(directory)) return false;
    const entries = fs.readdirSync(directory);
    return entries.some((entry) => /^task-\d+-.+\.md$/i.test(entry));
  } catch {
    return false;
  }
}

type LeadRunResult = {
  success: boolean;
  sessionId?: string;
  outputText?: string;
  error?: string;
  contextOverflow?: boolean;
};

async function runLeadTaskSplitting(args: {
  runtime: OttoWorkflowRuntime;
  prompt: string;
}): Promise<{ result: LeadRunResult; sessionIdForRetry: string | null }> {
  const initialSessionId = args.runtime.state.workflow?.techLeadSessionId;
  const runOnce = async (sessionId?: string) =>
    (await args.runtime.runners.lead.run({
      role: "lead",
      phaseName: "task-splitting",
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

async function ensureLeadOkSentinel(args: {
  runtime: OttoWorkflowRuntime;
  sessionIdForRetry: string | null;
  result: LeadRunResult;
  message: string;
}): Promise<boolean> {
  if (hasOkSentinel(args.result.outputText)) return true;
  return await sessionMicroRetry({
    runtime: args.runtime,
    role: "lead",
    sessionId: args.sessionIdForRetry,
    message: args.message,
  });
}

async function tryFixWrongDirTaskFiles(args: {
  runtime: OttoWorkflowRuntime;
  runDir: string;
}): Promise<boolean> {
  const worktreeRunDir = toWorktreePath({
    state: args.runtime.state,
    mainRepoFilePath: args.runDir,
  });
  if (!worktreeRunDir) return false;
  if (!directoryHasTaskFiles(worktreeRunDir)) return false;

  args.runtime.reminders.techLead.push(
    `Task files must be written to ${args.runDir}. You wrote them under the worktree. Move or recreate them at the main repo path.`,
  );
  const ok = await sessionMicroRetry({
    runtime: args.runtime,
    role: "lead",
    sessionId: args.runtime.state.workflow?.techLeadSessionId ?? null,
    message: `Move or recreate your task files at ${args.runDir} (absolute path) and reply with <OK>.`,
  });
  return ok && directoryHasTaskFiles(args.runDir);
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
    const { result, sessionIdForRetry } = await runLeadTaskSplitting({
      runtime: args.runtime,
      prompt: taskSplitPrompt,
    });

    if (!result.success) {
      const retry = await args.runtime.prompt.confirm(
        "Task splitting failed. Retry?",
        { defaultValue: true },
      );
      if (!retry) throw new Error(result.error ?? "Task splitting failed.");
      continue;
    }

    const ok = await ensureLeadOkSentinel({
      runtime: args.runtime,
      sessionIdForRetry,
      result,
      message: "Reply with <OK> only when task splitting is complete.",
    });
    if (!ok) {
      const retry = await args.runtime.prompt.confirm(
        "Task splitting missing <OK>. Retry?",
        { defaultValue: true },
      );
      if (!retry) {
        throw new Error("Task splitting missing <OK> sentinel.");
      }
      continue;
    }

    if (args.runtime.state.workflow) {
      args.runtime.state.workflow.techLeadSessionId = result.sessionId;
      await args.runtime.stateStore.save();
    }

    if (directoryHasTaskFiles(runDir)) {
      return;
    }

    if (await tryFixWrongDirTaskFiles({ runtime: args.runtime, runDir })) {
      return;
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
