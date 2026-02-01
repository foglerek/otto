import fs from "node:fs/promises";

import type { OttoWorkflowRuntime } from "../runtime.js";
import { fileExistsAndHasContent } from "../file-utils.js";
import { summaryReviewFilePath } from "../task-artifacts.js";
import { getTaskAgentSystemReminder } from "../system-reminders.js";
import { sessionMicroRetry } from "../micro-retry.js";

const MAX_SUMMARY_CHARS = 3000;
const MAX_ATTEMPTS = 2;

export async function summarizeReview(args: {
  runtime: OttoWorkflowRuntime;
  reviewFilePath: string;
}): Promise<string | null> {
  const summaryPath = summaryReviewFilePath(
    args.runtime.state,
    args.reviewFilePath,
  );
  if (fileExistsAndHasContent(summaryPath)) return summaryPath;
  if (!fileExistsAndHasContent(args.reviewFilePath)) return null;

  let sessionId: string | null = null;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    const prompt = [
      getTaskAgentSystemReminder(args.runtime),
      "<INSTRUCTIONS>",
      "Produce a very short bullet summary for the tech lead.",
      `Keep it <= ${MAX_SUMMARY_CHARS} characters.`,
      `Save it to: ${summaryPath}`,
      "Reply <OK> when done.",
      "</INSTRUCTIONS>",
      "<INPUT>",
      args.reviewFilePath,
      "</INPUT>",
      "<OUTPUT>",
      summaryPath,
      "</OUTPUT>",
      "<system-reminder>Use the exact paths given to you to read and write the input and output files.</system-reminder>",
    ].join("\n");

    const result = await args.runtime.runners.summarize.run({
      role: "summarize",
      phaseName: "summarize-review",
      prompt,
      cwd: args.runtime.state.worktree.worktreePath,
      exec: args.runtime.exec,
      sessionId: sessionId ?? undefined,
      timeoutMs: 2 * 60_000,
    });

    sessionId = result.sessionId ?? sessionId;
    if (!result.success) {
      await fs.unlink(summaryPath).catch(() => undefined);
      return null;
    }

    if (!fileExistsAndHasContent(summaryPath)) {
      await fs.unlink(summaryPath).catch(() => undefined);
      continue;
    }

    const content = await fs.readFile(summaryPath, "utf8");
    if (content.length <= MAX_SUMMARY_CHARS) {
      return summaryPath;
    }

    const ok = await sessionMicroRetry({
      runtime: args.runtime,
      role: "summarize",
      sessionId,
      message: `Rewrite ${summaryPath} to be <= ${MAX_SUMMARY_CHARS} characters.`,
    });
    if (!ok) break;
  }

  await fs.unlink(summaryPath).catch(() => undefined);
  return null;
}
