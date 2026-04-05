import type { OttoConfig } from "@otto/config";
import type { OttoExec, OttoExecResult, OttoPromptAdapter } from "@otto/ports";

export interface MergeBackResult {
  status: "merged" | "skipped" | "aborted" | "failed";
  message: string;
}

async function runGit(
  exec: OttoExec,
  cwd: string,
  args: string[],
  timeoutMs = 120_000,
): Promise<OttoExecResult> {
  return await exec.run(["git", ...args], {
    cwd,
    timeoutMs,
    label: `git ${args.join(" ")}`,
  });
}

export async function readGitRef(
  exec: OttoExec,
  cwd: string,
  ref: string,
): Promise<string | null> {
  const result = await runGit(exec, cwd, ["rev-parse", "--verify", "--quiet", ref], 30_000);
  if (result.exitCode !== 0 || result.timedOut) {
    return null;
  }
  const value = result.stdout.trim();
  return value.length > 0 ? value : null;
}

async function listUnmergedFiles(exec: OttoExec, cwd: string): Promise<string[]> {
  const result = await runGit(exec, cwd, ["diff", "--name-only", "--diff-filter=U"], 30_000);
  if (result.exitCode !== 0 || result.timedOut) {
    return [];
  }
  return result.stdout.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
}

export async function ensureMergeSourceBranchExists(args: {
  exec: OttoExec;
  repoPath: string;
  worktreeBranch: string;
}): Promise<MergeBackResult | null> {
  const branchExists = await runGit(args.exec, args.repoPath, [
    "rev-parse",
    "--verify",
    "--quiet",
    args.worktreeBranch,
  ]);
  if (branchExists.exitCode !== 0 || branchExists.timedOut) {
    return {
      status: "failed",
      message: `Merge-back failed: source branch ${args.worktreeBranch} was not found in ${args.repoPath}.`,
    };
  }
  return null;
}

export async function ensureBaseBranchCheckedOut(args: {
  exec: OttoExec;
  prompt: OttoPromptAdapter;
  repoPath: string;
  baseBranch: string;
  mergeInProgress: boolean;
}): Promise<MergeBackResult | null> {
  const currentBranch = await runGit(args.exec, args.repoPath, [
    "rev-parse",
    "--abbrev-ref",
    "HEAD",
  ], 30_000);
  if (currentBranch.exitCode !== 0 || currentBranch.timedOut) {
    return {
      status: "failed",
      message: "Merge-back failed: unable to determine current main repo branch.",
    };
  }

  const currentBranchName = currentBranch.stdout.trim();
  if (currentBranchName === args.baseBranch) {
    return null;
  }

  if (args.mergeInProgress) {
    return {
      status: "failed",
      message: `Merge-back recovery failed: merge is in progress but ${args.baseBranch} is not checked out (current branch: ${currentBranchName}).`,
    };
  }

  const switchOk = await args.prompt.confirm(
    `Main repo is on ${currentBranchName}; switch to ${args.baseBranch} for merge-back?`,
    { defaultValue: true },
  );
  if (!switchOk) {
    return {
      status: "skipped",
      message: `Skipped merge-back because base branch ${args.baseBranch} is not checked out.`,
    };
  }

  const checkout = await runGit(args.exec, args.repoPath, ["checkout", args.baseBranch], 60_000);
  if (checkout.exitCode !== 0 || checkout.timedOut) {
    return {
      status: "failed",
      message: `Merge-back failed: could not switch to ${args.baseBranch} (${checkout.stderr || checkout.stdout || "checkout failed"}).`,
    };
  }
  return null;
}

export async function prepareMergeBackMerge(args: {
  prompt: OttoPromptAdapter;
  config: OttoConfig;
  exec: OttoExec;
  repoPath: string;
  baseBranch: string;
  worktreeBranch: string;
  abortPendingMerge: (exec: OttoExec, cwd: string) => Promise<void>;
  attemptConflictResolution: (args: {
    prompt: OttoPromptAdapter;
    config: OttoConfig;
    exec: OttoExec;
    repoPath: string;
    baseBranch: string;
    worktreeBranch: string;
  }) => Promise<{ ok: boolean; message: string }>;
}): Promise<{ alreadyPrepared: boolean; earlyResult: MergeBackResult | null }> {
  const mergeHead = await readGitRef(args.exec, args.repoPath, "MERGE_HEAD");
  const mergeInProgress = mergeHead !== null;
  const statusBefore = await runGit(args.exec, args.repoPath, ["status", "--porcelain=v1"], 30_000);
  if (statusBefore.exitCode !== 0 || statusBefore.timedOut) {
    return {
      alreadyPrepared: false,
      earlyResult: {
        status: "failed",
        message: "Merge-back failed: unable to inspect main repo git status.",
      },
    };
  }

  if (!mergeInProgress && statusBefore.stdout.trim().length > 0) {
    return {
      alreadyPrepared: false,
      earlyResult: {
        status: "aborted",
        message:
          "Merge-back aborted: main repo has uncommitted changes. Commit/stash first and rerun resume.",
      },
    };
  }

  const branchCheck = await ensureBaseBranchCheckedOut({
    exec: args.exec,
    prompt: args.prompt,
    repoPath: args.repoPath,
    baseBranch: args.baseBranch,
    mergeInProgress,
  });
  if (branchCheck) {
    return { alreadyPrepared: false, earlyResult: branchCheck };
  }

  if (mergeInProgress) {
    const unresolved = await listUnmergedFiles(args.exec, args.repoPath);
    if (unresolved.length === 0) {
      return { alreadyPrepared: true, earlyResult: null };
    }

    const resolution = await args.attemptConflictResolution({
      prompt: args.prompt,
      config: args.config,
      exec: args.exec,
      repoPath: args.repoPath,
      baseBranch: args.baseBranch,
      worktreeBranch: args.worktreeBranch,
    });
    if (!resolution.ok) {
      await args.abortPendingMerge(args.exec, args.repoPath);
      return {
        alreadyPrepared: false,
        earlyResult: {
          status: "failed",
          message: resolution.message,
        },
      };
    }
    return { alreadyPrepared: true, earlyResult: null };
  }

  const alreadyMerged = await runGit(args.exec, args.repoPath, [
    "merge-base",
    "--is-ancestor",
    args.worktreeBranch,
    args.baseBranch,
  ], 30_000);
  if (alreadyMerged.exitCode === 0 && !alreadyMerged.timedOut) {
    return {
      alreadyPrepared: false,
      earlyResult: {
        status: "skipped",
        message: `Skipped merge-back: ${args.worktreeBranch} is already merged into ${args.baseBranch}.`,
      },
    };
  }

  const merge = await runGit(args.exec, args.repoPath, [
    "merge",
    "--no-ff",
    "--no-commit",
    args.worktreeBranch,
  ], 5 * 60_000);
  if (merge.exitCode === 0 && !merge.timedOut) {
    return { alreadyPrepared: true, earlyResult: null };
  }

  const resolution = await args.attemptConflictResolution({
    prompt: args.prompt,
    config: args.config,
    exec: args.exec,
    repoPath: args.repoPath,
    baseBranch: args.baseBranch,
    worktreeBranch: args.worktreeBranch,
  });
  if (!resolution.ok) {
    await args.abortPendingMerge(args.exec, args.repoPath);
    const mergeMessage = (merge.stderr || merge.stdout || "merge command failed").trim();
    return {
      alreadyPrepared: false,
      earlyResult: {
        status: "failed",
        message: `${resolution.message} (git merge output: ${mergeMessage})`,
      },
    };
  }

  return { alreadyPrepared: true, earlyResult: null };
}
