import fs from "node:fs/promises";
import path from "node:path";

import type { OttoWorkflowRuntime } from "./runtime.js";
import { createTaskQueue } from "./task-queue.js";
import { executeTask } from "./steps/task-execution.js";
import { executeQualityCheck } from "./steps/quality-check.js";
import { executeTaskReview } from "./steps/task-review.js";
import { summarizeReport } from "./steps/summarize-report.js";
import { summarizeReview } from "./steps/summarize-review.js";
import { executeTechLeadDecision } from "./steps/tech-lead-decision.js";
import { getBaseTaskInfo } from "./task-metadata.js";

async function gitCommitTask(
  runtime: OttoWorkflowRuntime,
  taskFile: string,
): Promise<void> {
  const message = `Accept task ${path.basename(taskFile)}`;

  const addResult = await runtime.exec.run(["git", "add", "-A"], {
    cwd: runtime.state.worktree.worktreePath,
    label: "git-add",
  });
  if (addResult.exitCode !== 0 || addResult.timedOut) {
    throw new Error(`git add failed: ${addResult.stderr || addResult.stdout}`);
  }

  const diffResult = await runtime.exec.run(
    ["git", "diff", "--cached", "--quiet"],
    {
      cwd: runtime.state.worktree.worktreePath,
      label: "git-diff-cached",
    },
  );

  // Exit code meanings:
  // 0 = no staged changes
  // 1 = staged changes exist
  // >1 = error
  if (diffResult.timedOut) {
    throw new Error("git diff --cached timed out");
  }
  if (diffResult.exitCode === 0) {
    return;
  }
  if (diffResult.exitCode !== 1) {
    throw new Error(
      `git diff --cached failed: ${diffResult.stderr || diffResult.stdout}`,
    );
  }

  const commitResult = await runtime.exec.run(
    ["git", "commit", "-m", message],
    {
      cwd: runtime.state.worktree.worktreePath,
      label: "git-commit",
    },
  );
  if (commitResult.exitCode !== 0 || commitResult.timedOut) {
    throw new Error(
      `git commit failed: ${commitResult.stderr || commitResult.stdout}`,
    );
  }
}

async function gitStashIfDirty(
  runtime: OttoWorkflowRuntime,
  reason: string,
): Promise<string | null> {
  const status = await runtime.exec.run(["git", "status", "--porcelain=v1"], {
    cwd: runtime.state.worktree.worktreePath,
    label: "git-status",
  });
  if (status.exitCode !== 0 || status.timedOut) {
    return null;
  }
  if (!status.stdout.trim()) {
    return null;
  }

  const marker = `otto:auto-stash:${runtime.state.runId}:${Date.now()}:${reason}`;
  const stash = await runtime.exec.run(
    ["git", "stash", "push", "-u", "-m", marker],
    {
      cwd: runtime.state.worktree.worktreePath,
      label: "git-stash",
    },
  );
  if (stash.exitCode !== 0 || stash.timedOut) {
    return null;
  }

  return marker;
}

async function gitDiscardUncommitted(
  runtime: OttoWorkflowRuntime,
): Promise<void> {
  // Best-effort: preserve work in a stash before discarding.
  await gitStashIfDirty(runtime, "discard-uncommitted");

  const reset = await runtime.exec.run(["git", "reset", "--hard"], {
    cwd: runtime.state.worktree.worktreePath,
    label: "git-reset",
  });
  if (reset.exitCode !== 0 || reset.timedOut) {
    throw new Error(`git reset --hard failed: ${reset.stderr || reset.stdout}`);
  }

  const clean = await runtime.exec.run(["git", "clean", "-fd"], {
    cwd: runtime.state.worktree.worktreePath,
    label: "git-clean",
  });
  if (clean.exitCode !== 0 || clean.timedOut) {
    throw new Error(`git clean -fd failed: ${clean.stderr || clean.stdout}`);
  }
}

export async function executeIntegratedTaskLoop(args: {
  runtime: OttoWorkflowRuntime;
  runDir: string;
}): Promise<void> {
  const queue = createTaskQueue(args.runtime);
  await queue.loadTasks({ runDir: args.runDir, ignoreState: false });

  while (queue.hasMoreTasks()) {
    const taskFile = queue.getCurrentTask();
    if (!taskFile) break;

    const taskExec = await executeTask(args.runtime, taskFile);
    if (!taskExec) {
      throw new Error(`Task execution failed: ${taskFile}`);
    }

    const qualityPassed = await executeQualityCheck({
      runtime: args.runtime,
      taskFile,
      reportFilePath: taskExec.reportFilePath,
      sessionId: taskExec.sessionId,
    });

    const reviewPath = await executeTaskReview({
      runtime: args.runtime,
      taskFile,
      reportFilePath: taskExec.reportFilePath,
    });
    if (!reviewPath) {
      throw new Error(`Task review failed: ${taskFile}`);
    }

    const reportSummaryPath = await summarizeReport({
      runtime: args.runtime,
      reportFilePath: taskExec.reportFilePath,
    });
    const reviewSummaryPath = await summarizeReview({
      runtime: args.runtime,
      reviewFilePath: reviewPath,
    });

    const reportSummaryContent = reportSummaryPath
      ? await fs.readFile(reportSummaryPath, "utf8")
      : undefined;
    const reviewSummaryContent = reviewSummaryPath
      ? await fs.readFile(reviewSummaryPath, "utf8")
      : undefined;

    const decision = await executeTechLeadDecision({
      runtime: args.runtime,
      taskFile,
      taskResult: {
        reportFilePath: taskExec.reportFilePath,
        reviewFilePath: reviewPath,
        reportSummaryContent,
        reviewSummaryContent,
        ...(qualityPassed
          ? {}
          : { fullReportFilePath: taskExec.reportFilePath }),
      },
    });

    if (!decision) {
      const retry = await args.runtime.prompt.confirm(
        "Tech lead decision failed. Retry?",
        { defaultValue: true },
      );
      if (!retry) throw new Error("Tech lead decision failed.");
      continue;
    }

    if (decision.acceptanceDecision === "remediation") {
      await queue.removeCurrentTask();
      await queue.addTaskToFront(decision.acceptanceOutput);
      continue;
    }

    if (decision.acceptanceDecision === "failed") {
      await gitDiscardUncommitted(args.runtime);
      await queue.removeCurrentTask();
      await queue.addTaskToFront(decision.acceptanceOutput);
      continue;
    }

    await gitCommitTask(args.runtime, taskFile);
    await queue.removeCurrentTask();

    // Clear per-task sessions for the base task after acceptance.
    const { baseTaskPath } = getBaseTaskInfo(taskFile);
    if (args.runtime.state.workflow) {
      if (args.runtime.state.workflow.taskAgentSessions) {
        delete args.runtime.state.workflow.taskAgentSessions[baseTaskPath];
      }
      if (args.runtime.state.workflow.reviewerSessions) {
        delete args.runtime.state.workflow.reviewerSessions[baseTaskPath];
      }
      await args.runtime.stateStore.save();
    }
  }
}
