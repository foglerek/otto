import fs from "node:fs/promises";
import path from "node:path";

import type { OttoWorkflowRuntime } from "../runtime.js";
import { getTechLeadSystemReminder } from "../system-reminders.js";
import { fileExistsAndHasContent } from "../file-utils.js";
import { getPlanFilePath, getRunDir, toWorktreePath } from "../paths.js";
import { sanitizeAbsolutePathsInMarkdown } from "../sanitize-markdown.js";
import { sessionMicroRetry } from "../micro-retry.js";
import { hasOkSentinel } from "../sentinels.js";

async function git(
  runtime: OttoWorkflowRuntime,
  cmd: string[],
  timeoutMs = 60_000,
) {
  return await runtime.exec.run(["git", ...cmd], {
    cwd: runtime.state.worktree.worktreePath,
    timeoutMs,
    label: `git ${cmd.join(" ")}`,
  });
}

async function commitIfDirty(
  runtime: OttoWorkflowRuntime,
  message: string,
): Promise<void> {
  const add = await git(runtime, ["add", "-A"], 60_000);
  if (add.exitCode !== 0 || add.timedOut) {
    throw new Error(`git add failed: ${add.stderr || add.stdout}`);
  }

  const diff = await git(runtime, ["diff", "--cached", "--quiet"], 30_000);
  if (diff.timedOut) throw new Error("git diff --cached timed out");
  if (diff.exitCode === 0) return; // nothing staged
  if (diff.exitCode !== 1) {
    throw new Error(`git diff --cached failed: ${diff.stderr || diff.stdout}`);
  }

  const commit = await git(runtime, ["commit", "-m", message], 60_000);
  if (commit.exitCode !== 0 || commit.timedOut) {
    throw new Error(`git commit failed: ${commit.stderr || commit.stdout}`);
  }
}

export async function runFinalizePhase(args: {
  runtime: OttoWorkflowRuntime;
}): Promise<void> {
  const runDir = getRunDir(args.runtime.state);
  const planFilePath = getPlanFilePath(args.runtime.state);
  const finalReportPath = path.join(runDir, "final-report.md");

  const outcomeFiles = await fs
    .readdir(runDir)
    .then((names) => names.filter((n) => n.startsWith("outcome-task-")))
    .catch(() => []);
  const outcomePaths = outcomeFiles
    .filter((n) => n.endsWith(".md"))
    .map((n) => path.join(runDir, n));

  const prompt = [
    getTechLeadSystemReminder(args.runtime, "review"),
    "<INSTRUCTIONS>",
    "All tasks have been executed and verified.",
    "Write a final report summarizing what was done, what changed, and any follow-ups.",
    "Read the plan and the task outcomes before writing the report.",
    `Create the final report file at: ${finalReportPath}`,
    "Use headings: ## Summary, ## Changes, ## Verification, ## Follow-ups.",
    "Reply <OK> when done.",
    "</INSTRUCTIONS>",
    "<INPUT_PLAN>",
    planFilePath,
    "</INPUT_PLAN>",
    outcomePaths.length > 0
      ? ["<INPUT_OUTCOMES>", ...outcomePaths, "</INPUT_OUTCOMES>"].join("\n")
      : "",
    "<OUTPUT>",
    finalReportPath,
    "</OUTPUT>",
    "<system-reminder>Use the exact paths given to you to read and write the input and output files.</system-reminder>",
  ].join("\n");

  const runOnce = async (sessionId?: string) =>
    await args.runtime.runners.lead.run({
      role: "lead",
      phaseName: "finalize",
      prompt,
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
    throw new Error(result.error ?? "Finalize failed.");
  }

  if (!hasOkSentinel(result.outputText)) {
    const ok = await sessionMicroRetry({
      runtime: args.runtime,
      role: "lead",
      sessionId: result.sessionId ?? sessionId ?? null,
      message: "Reply with <OK> only when finalization is complete.",
    });
    if (!ok) {
      throw new Error("Finalize missing <OK> sentinel.");
    }
  }

  if (args.runtime.state.workflow) {
    args.runtime.state.workflow.techLeadSessionId = result.sessionId;
    await args.runtime.stateStore.save();
  }

  if (!fileExistsAndHasContent(finalReportPath)) {
    const worktreeFinalReportPath = toWorktreePath({
      state: args.runtime.state,
      mainRepoFilePath: finalReportPath,
    });
    if (
      worktreeFinalReportPath &&
      fileExistsAndHasContent(worktreeFinalReportPath)
    ) {
      args.runtime.reminders.techLead.push(
        `You wrote Otto artifacts under the worktree. Create the final report at: ${finalReportPath}`,
      );
      await sessionMicroRetry({
        runtime: args.runtime,
        role: "lead",
        sessionId: args.runtime.state.workflow?.techLeadSessionId ?? null,
        message: `Move or recreate the final report at ${finalReportPath} and reply with <OK>.`,
      });
    }

    if (!fileExistsAndHasContent(finalReportPath)) {
      throw new Error(`Final report missing or empty: ${finalReportPath}`);
    }
  }

  // Sanitize absolute paths in artifacts we wrote.
  await sanitizeAbsolutePathsInMarkdown({
    filePath: finalReportPath,
    prefixes: [
      args.runtime.state.worktree.worktreePath,
      args.runtime.state.mainRepoPath,
    ],
  });

  // Best-effort: sanitize any modified markdown files in the worktree.
  const changed = await git(args.runtime, ["diff", "--name-only"], 30_000);
  const staged = await git(
    args.runtime,
    ["diff", "--cached", "--name-only"],
    30_000,
  );
  const files = new Set(
    `${changed.stdout}\n${staged.stdout}`
      .split(/\r?\n/)
      .map((s) => s.trim())
      .filter(Boolean)
      .filter((f) => f.endsWith(".md")),
  );

  for (const rel of files) {
    const fp = path.join(args.runtime.state.worktree.worktreePath, rel);
    await fs
      .stat(fp)
      .then(() =>
        sanitizeAbsolutePathsInMarkdown({
          filePath: fp,
          prefixes: [
            args.runtime.state.worktree.worktreePath,
            args.runtime.state.mainRepoPath,
          ],
        }),
      )
      .catch(() => undefined);
  }

  await commitIfDirty(
    args.runtime,
    `Finalize: ${args.runtime.state.ask.slug} (${args.runtime.state.runId})`,
  );
}
