import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";

import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { interopDefault: true });
const mod = await jiti(
  new URL("../src/workflow/integration/merge-step.ts", import.meta.url).href,
);

function makeRuntime(args) {
  const queue = [...args.script];
  const calls = [];

  const runtime = {
    state: {
      worktree: {
        worktreePath: args.worktreePath,
        baseBranch: "main",
      },
    },
    prompt: {
      async confirm() {
        return args.confirm ?? true;
      },
    },
    exec: {
      async run(cmd) {
        const command = cmd.join(" ");
        calls.push(command);

        const next = queue.shift();
        if (!next) {
          throw new Error(`Unexpected command: ${command}`);
        }

        const matches =
          typeof next.match === "string"
            ? command === next.match
            : next.match.test(command);
        assert.equal(matches, true, `Unexpected command order: ${command}`);

        return {
          exitCode: 0,
          stdout: "",
          stderr: "",
          timedOut: false,
          ...(next.result ?? {}),
        };
      },
    },
  };

  return {
    runtime,
    calls,
    assertDone() {
      assert.equal(queue.length, 0, "Not all scripted commands were used.");
    },
  };
}

function makeTempWorktree() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "otto-merge-"));
}

test("merge step aborts when user declines prompt", async () => {
  const worktreePath = makeTempWorktree();
  try {
    const { runtime, calls, assertDone } = makeRuntime({
      worktreePath,
      confirm: false,
      script: [],
    });

    const out = await mod.runMergeStep({
      runtime,
      createRemediationTask: async () => ({ created: false }),
    });

    assert.equal(out.outcome, "aborted");
    assert.match(out.message ?? "", /aborted merge step/i);
    assert.deepEqual(calls, []);
    assertDone();
  } finally {
    fs.rmSync(worktreePath, { recursive: true, force: true });
  }
});

test("merge in progress with conflicts creates remediation task", async () => {
  const worktreePath = makeTempWorktree();
  const mergeHeadPath = path.join(worktreePath, ".git", "MERGE_HEAD");
  fs.mkdirSync(path.dirname(mergeHeadPath), { recursive: true });
  fs.writeFileSync(mergeHeadPath, "in-progress\n", "utf8");

  let remediation;

  try {
    const { runtime, assertDone } = makeRuntime({
      worktreePath,
      script: [
        {
          match: "git rev-parse --git-path MERGE_HEAD",
          result: { stdout: `${mergeHeadPath}\n` },
        },
        {
          match: "git diff --name-only --diff-filter=U",
          result: { stdout: "conflicted.ts\n" },
        },
      ],
    });

    const out = await mod.runMergeStep({
      runtime,
      createRemediationTask: async (args) => {
        remediation = args;
        return { created: true };
      },
    });

    assert.equal(out.outcome, "tasks-created");
    assert.equal(remediation.type, "merge-conflict");
    assert.match(remediation.failureSummary, /unresolved conflicts/i);
    assertDone();
  } finally {
    fs.rmSync(worktreePath, { recursive: true, force: true });
  }
});

test("failed merge includes autostash ref in remediation summary", async () => {
  const worktreePath = makeTempWorktree();
  let remediation;
  const originalNow = Date.now;
  Date.now = () => 12345;

  try {
    const { runtime, calls, assertDone } = makeRuntime({
      worktreePath,
      script: [
        { match: "git rev-parse --git-path MERGE_HEAD", result: { exitCode: 1 } },
        { match: "git fetch --prune origin main" },
        { match: "git rev-parse --verify --quiet origin/main" },
        {
          match: "git status --porcelain=v1",
          result: { stdout: " M src/file.ts\n" },
        },
        {
          match: "git stash push -u -m otto-integration-autostash-12345",
        },
        {
          match: "git stash list --format=%gd:%s",
          result: {
            stdout: "stash@{0}: On main: otto-integration-autostash-12345\n",
          },
        },
        {
          match: "git merge --no-ff --no-edit origin/main",
          result: { exitCode: 1, stderr: "conflict on merge" },
        },
        {
          match: "git merge --no-ff --no-edit main",
          result: { exitCode: 1, stderr: "fallback merge also failed" },
        },
      ],
    });

    const out = await mod.runMergeStep({
      runtime,
      createRemediationTask: async (args) => {
        remediation = args;
        return { created: true };
      },
    });

    assert.equal(out.outcome, "tasks-created");
    assert.match(remediation.failureSummary, /Autostash: stash@\{0\}/);
    assert.equal(
      calls.some((c) => c.startsWith("git stash apply")),
      false,
      "stash apply should not run when merge itself fails",
    );
    assertDone();
  } finally {
    Date.now = originalNow;
    fs.rmSync(worktreePath, { recursive: true, force: true });
  }
});

test("stash restore failure creates remediation and does not drop stash", async () => {
  const worktreePath = makeTempWorktree();
  let remediation;
  const originalNow = Date.now;
  Date.now = () => 999;

  try {
    const { runtime, calls, assertDone } = makeRuntime({
      worktreePath,
      script: [
        { match: "git rev-parse --git-path MERGE_HEAD", result: { exitCode: 1 } },
        { match: "git fetch --prune origin main" },
        { match: "git rev-parse --verify --quiet origin/main" },
        {
          match: "git status --porcelain=v1",
          result: { stdout: " M src/file.ts\n" },
        },
        {
          match: "git stash push -u -m otto-integration-autostash-999",
        },
        {
          match: "git stash list --format=%gd:%s",
          result: {
            stdout: "stash@{1}: On main: otto-integration-autostash-999\n",
          },
        },
        { match: "git merge --no-ff --no-edit origin/main" },
        {
          match: "git stash apply stash@{1}",
          result: { exitCode: 1, stderr: "apply failed" },
        },
      ],
    });

    const out = await mod.runMergeStep({
      runtime,
      createRemediationTask: async (args) => {
        remediation = args;
        return { created: true };
      },
    });

    assert.equal(out.outcome, "tasks-created");
    assert.match(remediation.failureSummary, /failed to restore stash stash@\{1\}/i);
    assert.equal(
      calls.some((c) => c === "git stash drop stash@{1}"),
      false,
      "stash drop should not run after failed apply",
    );
    assertDone();
  } finally {
    Date.now = originalNow;
    fs.rmSync(worktreePath, { recursive: true, force: true });
  }
});
