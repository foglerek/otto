import fs from "node:fs/promises";

import type { OttoWorkflowRuntime } from "../runtime.js";
import { getTaskAgentSystemReminder } from "../system-reminders.js";
import {
  ensureSentinelWithMicroRetry,
  sessionMicroRetry,
} from "../micro-retry.js";
import { getBaseTaskInfo } from "../task-metadata.js";
import { getQualityFixMaxAttempts } from "../retry-policy.js";
import { dispatchWorkflowAction } from "../state-reducer.js";

function formatFailureList(results: Array<{ name: string; ok: boolean }>) {
  const failures = results
    .filter((r) => !r.ok)
    .map((r) => `- ${r.name}`)
    .join("\n");
  return failures || "(unknown failures)";
}

function buildFixPrompt(args: {
  runtime: OttoWorkflowRuntime;
  failures: string;
  taskFile: string;
  reportFilePath: string;
}) {
  return [
    getTaskAgentSystemReminder(args.runtime),
    "The following quality checks failed after task execution. Fix all issues:",
    args.failures,
    "",
    `Task: ${args.taskFile}`,
    `Report: ${args.reportFilePath}`,
    "",
    `Append a section to ${args.reportFilePath} describing the fixes you made.`,
    "Reply <OK> when done.",
    "",
  ].join("\n");
}

async function appendUnresolvedFailures(args: {
  reportFilePath: string;
  results: Array<{ name: string; ok: boolean }>;
}) {
  const unresolved = args.results
    .filter((r) => !r.ok)
    .map((r) => `- ${r.name}`)
    .join("\n");
  if (!unresolved) return;
  await fs.appendFile(
    args.reportFilePath,
    `\n\n---\n\n## Quality Gate Failures (Unresolved)\n\n${unresolved}\n`,
    "utf8",
  );
}

type FixAttemptResult =
  | { kind: "overflow"; sessionId: null }
  | { kind: "failed"; sessionId: string | null }
  | { kind: "ok"; sessionId: string | null };

async function runQualityFixAttempt(args: {
  runtime: OttoWorkflowRuntime;
  prompt: string;
  baseTaskPath: string;
  sessionId: string | null;
}): Promise<FixAttemptResult> {
  const fixResult = await args.runtime.runners.task.run({
    role: "task",
    phaseName: "quality-fix",
    prompt: args.prompt,
    cwd: args.runtime.state.worktree.worktreePath,
    exec: args.runtime.exec,
    sessionId: args.sessionId ?? undefined,
    timeoutMs: 20 * 60_000,
  });

  if (args.sessionId && fixResult.contextOverflow) {
    await dispatchWorkflowAction(args.runtime.stateStore, {
      type: "set-task-agent-session",
      taskKey: args.baseTaskPath,
      sessionId: null,
      defaultPhase: "execution",
    });
    return { kind: "overflow", sessionId: null };
  }

  if (!fixResult.success) {
    return { kind: "failed", sessionId: args.sessionId };
  }

  const nextSessionId = fixResult.sessionId ?? args.sessionId;
  const ok = await ensureSentinelWithMicroRetry({
    runtime: args.runtime,
    role: "task",
    sessionId: nextSessionId,
    outputText: fixResult.outputText,
    message: "Reply <OK> only when the quality fixes are complete.",
  });
  if (!ok) {
    return { kind: "failed", sessionId: nextSessionId };
  }

  await dispatchWorkflowAction(args.runtime.stateStore, {
    type: "set-task-agent-session",
    taskKey: args.baseTaskPath,
    sessionId: nextSessionId,
    defaultPhase: "execution",
  });

  return { kind: "ok", sessionId: nextSessionId };
}

export async function executeQualityCheck(args: {
  runtime: OttoWorkflowRuntime;
  taskFile: string;
  reportFilePath: string;
  sessionId?: string | null;
}): Promise<boolean> {
  const quality = args.runtime.config.quality;
  if (!quality) return true;

  const { baseTaskPath } = getBaseTaskInfo(args.taskFile);
  let sessionId: string | null =
    args.sessionId ??
    args.runtime.state.workflow?.taskAgentSessions?.[baseTaskPath] ??
    null;

  const maxFixAttempts = getQualityFixMaxAttempts(args.runtime);
  let attempt = 0;

  const runChecks = async () =>
    await quality.adapter.runChecks({
      worktreePath: args.runtime.state.worktree.worktreePath,
      exec: args.runtime.exec,
      checks: quality.checks,
    });

  let result = await runChecks();
  if (result.ok) return true;

  while (!result.ok && attempt < maxFixAttempts) {
    attempt += 1;

    const fixPrompt = buildFixPrompt({
      runtime: args.runtime,
      failures: formatFailureList(result.results),
      taskFile: args.taskFile,
      reportFilePath: args.reportFilePath,
    });

    const fixAttempt = await runQualityFixAttempt({
      runtime: args.runtime,
      prompt: fixPrompt,
      baseTaskPath,
      sessionId,
    });

    if (fixAttempt.kind === "overflow") {
      sessionId = null;
      continue;
    }

    if (fixAttempt.kind === "failed") {
      sessionId = fixAttempt.sessionId;
      break;
    }

    sessionId = fixAttempt.sessionId;
    result = await runChecks();
  }

  if (!result.ok) {
    await appendUnresolvedFailures({
      reportFilePath: args.reportFilePath,
      results: result.results,
    });
  }

  return result.ok;
}
