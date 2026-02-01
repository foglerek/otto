import fs from "node:fs/promises";

import type { OttoWorkflowRuntime } from "../runtime.js";
import { getTaskAgentSystemReminder } from "../system-reminders.js";

export async function executeQualityCheck(args: {
  runtime: OttoWorkflowRuntime;
  taskFile: string;
  reportFilePath: string;
}): Promise<boolean> {
  const quality = args.runtime.config.quality;
  if (!quality) return true;

  const MAX_FIX_ATTEMPTS = 2;
  let attempt = 0;

  const runChecks = async () =>
    await quality.adapter.runChecks({
      worktreePath: args.runtime.state.worktree.worktreePath,
      exec: args.runtime.exec,
      checks: quality.checks,
    });

  let result = await runChecks();
  if (result.ok) return true;

  while (!result.ok && attempt < MAX_FIX_ATTEMPTS) {
    attempt += 1;
    const failures = result.results
      .filter((r) => !r.ok)
      .map((r) => `- ${r.name}`)
      .join("\n");
    const fixPrompt = [
      getTaskAgentSystemReminder(args.runtime),
      "The following quality checks failed after task execution. Fix all issues:",
      failures || "(unknown failures)",
      "",
      `Task: ${args.taskFile}`,
      `Report: ${args.reportFilePath}`,
      "",
      `Append a section to ${args.reportFilePath} describing the fixes you made.`,
      "Reply <OK> when done.",
      "",
    ].join("\n");

    const fixResult = await args.runtime.runners.task.run({
      role: "task",
      phaseName: "quality-fix",
      prompt: fixPrompt,
      cwd: args.runtime.state.worktree.worktreePath,
      exec: args.runtime.exec,
      timeoutMs: 20 * 60_000,
    });

    if (!fixResult.success) break;
    result = await runChecks();
  }

  const unresolved = result.results
    .filter((r) => !r.ok)
    .map((r) => `- ${r.name}`)
    .join("\n");
  if (!result.ok && unresolved) {
    await fs.appendFile(
      args.reportFilePath,
      `\n\n---\n\n## Quality Gate Failures (Unresolved)\n\n${unresolved}\n`,
      "utf8",
    );
  }

  return result.ok;
}
