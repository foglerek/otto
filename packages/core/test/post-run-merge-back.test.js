import assert from "node:assert/strict";
import { access, mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";

import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { interopDefault: true });
const mod = await jiti(
  new URL("../src/cli/post-run-merge-back.ts", import.meta.url).href,
);

function makeState() {
  return {
    runId: "2026-03-22-expo-graphql-resolvers",
    mainRepoPath: "/repo",
    worktree: {
      branchName: "workflow-2026-03-22-expo-graphql-resolvers",
      baseBranch: "main",
      worktreePath: "/repo/.worktrees/workflow-2026-03-22-expo-graphql-resolvers",
    },
    env: {},
    testEnv: {},
  };
}

function makePrompt(answers) {
  const queue = [...answers];
  return {
    async confirm() {
      if (queue.length === 0) return true;
      return queue.shift();
    },
  };
}

function makeExec(script) {
  const queue = [...script];
  return {
    async run(cmd) {
      const command = cmd.join(" ");
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
    assertDone() {
      assert.equal(queue.length, 0, "Not all scripted commands were used.");
    },
  };
}

function makeRunner(results = [{ success: true, outputText: "<OK>" }]) {
  const queue = [...results];
  const calls = [];
  return {
    runner: {
      id: "test-runner",
      kind: "test",
      async run(options) {
        calls.push(options);
        const next = queue.shift();
        return next ?? { success: true, outputText: "<OK>" };
      },
    },
    calls,
  };
}

function makeConfig(overrides = {}) {
  const { runner } = makeRunner();
  return {
    worktree: {
      baseBranch: "main",
      branchNamer: () => "x",
      afterCreate: async () => undefined,
      adapter: {},
    },
    runners: { default: runner },
    ...overrides,
  };
}

test("merge-back skips when user declines", async () => {
  const prompt = makePrompt([false]);
  const exec = makeExec([]);
  const result = await mod.maybeRunPostCleanupMergeBack({
    state: makeState(),
    config: makeConfig(),
    prompt,
    exec,
  });
  assert.equal(result.status, "skipped");
  exec.assertDone();
});

test("merge-back aborts when main repo has uncommitted changes", async () => {
  const prompt = makePrompt([true]);
  const exec = makeExec([
    {
      match:
        "git rev-parse --verify --quiet workflow-2026-03-22-expo-graphql-resolvers",
    },
    { match: "git rev-parse --verify --quiet MERGE_HEAD", result: { exitCode: 1 } },
    { match: "git status --porcelain=v1", result: { stdout: " M package.json\n" } },
  ]);

  const result = await mod.maybeRunPostCleanupMergeBack({
    state: makeState(),
    config: makeConfig(),
    prompt,
    exec,
  });

  assert.equal(result.status, "aborted");
  assert.match(result.message, /uncommitted changes/i);
  exec.assertDone();
});

test("merge-back runs checks and commits on success", async () => {
  const prompt = makePrompt([true]);
  const exec = makeExec([
    {
      match:
        "git rev-parse --verify --quiet workflow-2026-03-22-expo-graphql-resolvers",
    },
    { match: "git rev-parse --verify --quiet MERGE_HEAD", result: { exitCode: 1 } },
    { match: "git status --porcelain=v1" },
    { match: "git rev-parse --abbrev-ref HEAD", result: { stdout: "main\n" } },
    {
      match:
        "git merge-base --is-ancestor workflow-2026-03-22-expo-graphql-resolvers main",
      result: { exitCode: 1 },
    },
    {
      match:
        "git merge --no-ff --no-commit workflow-2026-03-22-expo-graphql-resolvers",
    },
    {
      match:
        /git commit -m Merge workflow-2026-03-22-expo-graphql-resolvers after Otto run 2026-03-22-expo-graphql-resolvers/,
    },
  ]);

  const qualityCalls = [];
  const integrationCalls = [];
  const result = await mod.maybeRunPostCleanupMergeBack({
    state: makeState(),
    config: makeConfig({
      quality: {
        checks: [{ name: "lint", cmd: ["yarn", "lint"] }],
        adapter: {
          async runChecks(args) {
            qualityCalls.push(args.worktreePath);
            return { ok: true, results: [{ name: "lint", ok: true, stdout: "", stderr: "" }] };
          },
        },
      },
      integration: {
        checks: [{ name: "int", cmd: ["yarn", "test:int"] }],
        adapter: {
          async runChecks(args) {
            integrationCalls.push(args.worktreePath);
            return { ok: true, results: [{ name: "int", ok: true, stdout: "", stderr: "" }] };
          },
        },
      },
    }),
    prompt,
    exec,
  });

  assert.equal(result.status, "merged");
  assert.deepEqual(qualityCalls, ["/repo"]);
  assert.deepEqual(integrationCalls, ["/repo"]);
  exec.assertDone();
});

test("merge-back aborts merge when post-merge checks fail", async () => {
  const prompt = makePrompt([true]);
  const exec = makeExec([
    {
      match:
        "git rev-parse --verify --quiet workflow-2026-03-22-expo-graphql-resolvers",
    },
    { match: "git rev-parse --verify --quiet MERGE_HEAD", result: { exitCode: 1 } },
    { match: "git status --porcelain=v1" },
    { match: "git rev-parse --abbrev-ref HEAD", result: { stdout: "main\n" } },
    {
      match:
        "git merge-base --is-ancestor workflow-2026-03-22-expo-graphql-resolvers main",
      result: { exitCode: 1 },
    },
    {
      match:
        "git merge --no-ff --no-commit workflow-2026-03-22-expo-graphql-resolvers",
    },
    { match: "git merge --abort" },
  ]);

  const result = await mod.maybeRunPostCleanupMergeBack({
    state: makeState(),
    config: makeConfig({
      quality: {
        checks: [{ name: "lint", cmd: ["yarn", "lint"] }],
        adapter: {
          async runChecks() {
            return {
              ok: false,
              results: [
                { name: "lint", ok: false, stdout: "", stderr: "lint failed" },
              ],
            };
          },
        },
      },
    }),
    prompt,
    exec,
  });

  assert.equal(result.status, "failed");
  assert.match(result.message, /validation failed/i);
  exec.assertDone();
});

test("merge-back resolves merge conflicts with task runner", async () => {
  const prompt = makePrompt([true, true]);
  const exec = makeExec([
    {
      match:
        "git rev-parse --verify --quiet workflow-2026-03-22-expo-graphql-resolvers",
    },
    { match: "git rev-parse --verify --quiet MERGE_HEAD", result: { exitCode: 1 } },
    { match: "git status --porcelain=v1" },
    { match: "git rev-parse --abbrev-ref HEAD", result: { stdout: "main\n" } },
    {
      match:
        "git merge-base --is-ancestor workflow-2026-03-22-expo-graphql-resolvers main",
      result: { exitCode: 1 },
    },
    {
      match:
        "git merge --no-ff --no-commit workflow-2026-03-22-expo-graphql-resolvers",
      result: { exitCode: 1, stderr: "CONFLICT (content): Merge conflict" },
    },
    {
      match: "git diff --name-only --diff-filter=U",
      result: { stdout: "src/conflict.ts\n" },
    },
    {
      match: "git diff --name-only --diff-filter=U",
      result: { stdout: "" },
    },
    {
      match:
        /git commit -m Merge workflow-2026-03-22-expo-graphql-resolvers after Otto run 2026-03-22-expo-graphql-resolvers/,
    },
  ]);
  const { runner, calls } = makeRunner([{ success: true, outputText: "<OK>" }]);

  const result = await mod.maybeRunPostCleanupMergeBack({
    state: makeState(),
    config: makeConfig({ runners: { default: runner } }),
    prompt,
    exec,
  });

  assert.equal(result.status, "merged");
  assert.equal(calls.length, 1);
  assert.equal(calls[0].role, "task");
  assert.match(calls[0].prompt, /src\/conflict.ts/);
  exec.assertDone();
});

test("merge-back aborts when automatic conflict resolution is declined", async () => {
  const prompt = makePrompt([true, false]);
  const exec = makeExec([
    {
      match:
        "git rev-parse --verify --quiet workflow-2026-03-22-expo-graphql-resolvers",
    },
    { match: "git rev-parse --verify --quiet MERGE_HEAD", result: { exitCode: 1 } },
    { match: "git status --porcelain=v1" },
    { match: "git rev-parse --abbrev-ref HEAD", result: { stdout: "main\n" } },
    {
      match:
        "git merge-base --is-ancestor workflow-2026-03-22-expo-graphql-resolvers main",
      result: { exitCode: 1 },
    },
    {
      match:
        "git merge --no-ff --no-commit workflow-2026-03-22-expo-graphql-resolvers",
      result: { exitCode: 1, stderr: "CONFLICT (content): Merge conflict" },
    },
    {
      match: "git diff --name-only --diff-filter=U",
      result: { stdout: "src/conflict.ts\n" },
    },
    { match: "git merge --abort" },
  ]);

  const result = await mod.maybeRunPostCleanupMergeBack({
    state: makeState(),
    config: makeConfig(),
    prompt,
    exec,
  });

  assert.equal(result.status, "failed");
  assert.match(result.message, /declined automatic conflict resolution/i);
  exec.assertDone();
});

test("ensureTemporaryMergeBackEnvFile writes and removes .env.test", async () => {
  const repoPath = await mkdtemp(path.join(os.tmpdir(), "otto-merge-back-env-"));
  const cleanup = await mod.ensureTemporaryMergeBackEnvFile({
    repoPath,
    testEnv: {
      DATABASE_URL: "postgres://localhost/test",
      AUTH_SECRET: "secret",
    },
  });

  const filePath = path.join(repoPath, ".env.test");
  const content = await readFile(filePath, "utf8");
  assert.match(content, /DATABASE_URL=postgres:\/\/localhost\/test/);
  assert.match(content, /AUTH_SECRET=secret/);

  await cleanup();
  await assert.rejects(access(filePath));
  await rm(repoPath, { recursive: true, force: true });
});
