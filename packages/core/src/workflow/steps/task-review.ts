import type { OttoWorkflowRuntime } from "../runtime.js";
import { getTaskReviewerSystemReminder } from "../system-reminders.js";
import { fileExistsAndHasContent } from "../file-utils.js";
import { toWorktreePath } from "../paths.js";
import { sessionMicroRetry } from "../micro-retry.js";
import { reviewFilePath } from "../task-artifacts.js";
import { getBaseTaskInfo } from "../task-metadata.js";

export async function executeTaskReview(args: {
  runtime: OttoWorkflowRuntime;
  taskFile: string;
  reportFilePath: string;
}): Promise<string | null> {
  const reviewPath = reviewFilePath(args.runtime.state, args.taskFile);

  if (fileExistsAndHasContent(reviewPath)) {
    return reviewPath;
  }

  const { baseTaskPath } = getBaseTaskInfo(args.taskFile);
  const sessionKey = baseTaskPath;
  const wf = args.runtime.state.workflow;
  const persisted = wf?.reviewerSessions?.[sessionKey] ?? null;
  let sessionId: string | null = persisted;

  const prompt = [
    getTaskReviewerSystemReminder(args.runtime),
    "<INSTRUCTIONS>",
    "You are reviewing uncommitted changes in the worktree.",
    "Write a concise review for the tech lead.",
    `Save it to: ${reviewPath}`,
    "</INSTRUCTIONS>",
    "<INPUT_TASK>",
    args.taskFile,
    "</INPUT_TASK>",
    "<INPUT_REPORT>",
    args.reportFilePath,
    "</INPUT_REPORT>",
    "<OUTPUT>",
    reviewPath,
    "</OUTPUT>",
    "<system-reminder>Use the exact paths given to you to read and write the input and output files.</system-reminder>",
  ].join("\n");

  const runReview = async (overrideSession: string | null) =>
    await args.runtime.runners.reviewer.run({
      role: "reviewer",
      phaseName: "code-review",
      prompt,
      cwd: args.runtime.state.worktree.worktreePath,
      exec: args.runtime.exec,
      sessionId: overrideSession ?? undefined,
      timeoutMs: 15 * 60_000,
    });

  let reviewResult = await runReview(sessionId);
  if (sessionId && reviewResult.contextOverflow) {
    if (wf?.reviewerSessions) {
      wf.reviewerSessions[sessionKey] = null;
      await args.runtime.stateStore.save();
    }
    sessionId = null;
    reviewResult = await runReview(null);
  }

  if (!reviewResult.success) return null;

  sessionId = reviewResult.sessionId ?? sessionId;
  if (wf?.reviewerSessions) {
    wf.reviewerSessions[sessionKey] = sessionId;
    await args.runtime.stateStore.save();
  }

  const worktreeReviewPath = toWorktreePath({
    state: args.runtime.state,
    mainRepoFilePath: reviewPath,
  });
  if (
    !fileExistsAndHasContent(reviewPath) &&
    worktreeReviewPath &&
    fileExistsAndHasContent(worktreeReviewPath)
  ) {
    args.runtime.reminders.techLead.push(
      `Write the code review to ${reviewPath} (main repo .otto), not the worktree .otto.`,
    );
    await sessionMicroRetry({
      runtime: args.runtime,
      role: "reviewer",
      sessionId,
      message: `Your review must be written to ${reviewPath}. Recreate it there and reply with <OK>.`,
    });
  }

  if (!fileExistsAndHasContent(reviewPath)) return null;
  return reviewPath;
}
