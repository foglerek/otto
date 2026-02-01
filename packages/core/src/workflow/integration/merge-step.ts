import fsSync from "node:fs";
import path from "node:path";

import type { OttoWorkflowRuntime } from "../runtime.js";
import { createIntegrationRemediationTask } from "./remediation-task.js";
import type { IntegrationStepResult } from "./types.js";

async function git(
  args: OttoWorkflowRuntime,
  cmd: string[],
  timeoutMs = 60_000,
) {
  return await args.exec.run(["git", ...cmd], {
    cwd: args.state.worktree.worktreePath,
    timeoutMs,
    label: `git ${cmd.join(" ")}`,
  });
}

async function getGitPath(
  runtime: OttoWorkflowRuntime,
  name: string,
): Promise<string | null> {
  const result = await git(runtime, ["rev-parse", "--git-path", name], 15_000);
  if (result.exitCode !== 0 || result.timedOut) return null;
  const out = result.stdout.trim();
  if (!out) return null;
  return path.isAbsolute(out)
    ? out
    : path.join(runtime.state.worktree.worktreePath, out);
}

async function hasMergeInProgress(
  runtime: OttoWorkflowRuntime,
): Promise<boolean> {
  const mergeHead = await getGitPath(runtime, "MERGE_HEAD");
  return Boolean(mergeHead && fsSync.existsSync(mergeHead));
}

async function hasConflicts(runtime: OttoWorkflowRuntime): Promise<boolean> {
  const res = await git(
    runtime,
    ["diff", "--name-only", "--diff-filter=U"],
    30_000,
  );
  return res.exitCode === 0 && Boolean(res.stdout.trim());
}

async function autostashIfDirty(
  runtime: OttoWorkflowRuntime,
): Promise<string | null> {
  const status = await git(runtime, ["status", "--porcelain=v1"], 30_000);
  if (status.exitCode !== 0 || status.timedOut) return null;
  if (!status.stdout.trim()) return null;

  const marker = `otto-integration-autostash-${Date.now()}`;
  const stash = await git(
    runtime,
    ["stash", "push", "-u", "-m", marker],
    60_000,
  );
  if (stash.exitCode !== 0 || stash.timedOut) return null;

  const list = await git(runtime, ["stash", "list", "--format=%gd:%s"], 30_000);
  if (list.exitCode !== 0 || list.timedOut) return null;
  const line = list.stdout.split(/\r?\n/).find((l) => l.includes(marker));
  if (!line) return null;
  const ref = line.split(":")[0]?.trim();
  return ref || null;
}

async function restoreStash(
  runtime: OttoWorkflowRuntime,
  ref: string,
): Promise<boolean> {
  const apply = await git(runtime, ["stash", "apply", ref], 60_000);
  if (apply.exitCode !== 0 || apply.timedOut) return false;
  const drop = await git(runtime, ["stash", "drop", ref], 30_000);
  return drop.exitCode === 0 && !drop.timedOut;
}

async function createMergeConflictRemediation(args: {
  runtime: OttoWorkflowRuntime;
  failureSummary: string;
}): Promise<IntegrationStepResult> {
  const task = await createIntegrationRemediationTask({
    runtime: args.runtime,
    type: "merge-conflict",
    failureSummary: args.failureSummary,
  });

  return task.created
    ? { outcome: "tasks-created" }
    : { outcome: "aborted", message: "Failed to create remediation task" };
}

async function handleMergeAlreadyInProgress(
  runtime: OttoWorkflowRuntime,
): Promise<IntegrationStepResult | null> {
  const inProgress = await hasMergeInProgress(runtime);
  if (!inProgress) return null;

  const conflicts = await hasConflicts(runtime);
  if (conflicts) {
    return await createMergeConflictRemediation({
      runtime,
      failureSummary:
        "A merge is already in progress and there are unresolved conflicts (diff-filter=U).",
    });
  }

  const cont = await git(runtime, ["merge", "--continue"], 5 * 60_000);
  if (cont.exitCode !== 0 || cont.timedOut) {
    return await createMergeConflictRemediation({
      runtime,
      failureSummary: `Merge continuation failed:\n${cont.stderr || cont.stdout}`,
    });
  }

  return { outcome: "success" };
}

async function resolveMergeTarget(
  runtime: OttoWorkflowRuntime,
): Promise<string> {
  // Best-effort fetch; ignore failures (some repos may have no remote).
  await git(
    runtime,
    ["fetch", "--prune", "origin", runtime.state.worktree.baseBranch],
    2 * 60_000,
  );

  const originRef = `origin/${runtime.state.worktree.baseBranch}`;
  const originExists = await git(
    runtime,
    ["rev-parse", "--verify", "--quiet", originRef],
    30_000,
  );

  return originExists.exitCode === 0 && !originExists.timedOut
    ? originRef
    : runtime.state.worktree.baseBranch;
}

async function mergeIntoWorktree(args: {
  runtime: OttoWorkflowRuntime;
  mergeTarget: string;
}): Promise<{ ok: boolean; stderrOrStdout: string; stashRef: string | null }> {
  const stashRef = await autostashIfDirty(args.runtime);
  let merge = await git(
    args.runtime,
    ["merge", "--no-ff", "--no-edit", args.mergeTarget],
    5 * 60_000,
  );

  if (
    (merge.exitCode !== 0 || merge.timedOut) &&
    args.mergeTarget !== args.runtime.state.worktree.baseBranch
  ) {
    // Fallback for repos without an origin ref.
    merge = await git(
      args.runtime,
      ["merge", "--no-ff", "--no-edit", args.runtime.state.worktree.baseBranch],
      5 * 60_000,
    );
  }

  const ok = merge.exitCode === 0 && !merge.timedOut;
  return {
    ok,
    stderrOrStdout: (merge.stderr || merge.stdout || "").trim(),
    stashRef,
  };
}

export async function runMergeStep(args: {
  runtime: OttoWorkflowRuntime;
}): Promise<IntegrationStepResult> {
  const ok = await args.runtime.prompt.confirm(
    `Integration: merge ${args.runtime.state.worktree.baseBranch} into worktree?`,
    { defaultValue: true },
  );
  if (!ok) return { outcome: "aborted", message: "User aborted merge step" };

  const runtime = args.runtime;

  const inProgress = await handleMergeAlreadyInProgress(runtime);
  if (inProgress) return inProgress;

  const mergeTarget = await resolveMergeTarget(runtime);
  const merge = await mergeIntoWorktree({ runtime, mergeTarget });
  if (!merge.ok) {
    return await createMergeConflictRemediation({
      runtime,
      failureSummary: `Merge failed:\n${merge.stderrOrStdout}${merge.stashRef ? `\n\nAutostash: ${merge.stashRef}` : ""}`,
    });
  }

  if (merge.stashRef) {
    const restored = await restoreStash(runtime, merge.stashRef);
    if (!restored) {
      return await createMergeConflictRemediation({
        runtime,
        failureSummary: `Merge succeeded but failed to restore stash ${merge.stashRef}. Resolve manually.`,
      });
    }
  }

  return { outcome: "success" };
}
