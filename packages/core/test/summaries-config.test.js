import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";

import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { interopDefault: true });
const reportMod = await jiti(new URL("../src/workflow/steps/summarize-report.ts", import.meta.url).href);
const reviewMod = await jiti(new URL("../src/workflow/steps/summarize-review.ts", import.meta.url).href);

function makeRuntime(repoPath, summarizeRunner, summariesConfig = {}) {
  return {
    config: { summaries: summariesConfig },
    prompt: {},
    exec: {},
    registry: { register() {}, killAll() {}, size() { return 0; } },
    stateStore: {
      filePath: path.join(repoPath, ".otto", "states", "dummy.json"),
      state: {},
      async save() {},
      async update(mutator) {
        mutator({});
        return {};
      },
    },
    state: {
      kind: "otto.state",
      version: 1,
      runId: "2026-02-04-summary",
      createdAt: new Date().toISOString(),
      mainRepoPath: repoPath,
      artifactRootDir: path.join(repoPath, ".otto"),
      stateFilePath: path.join(repoPath, ".otto", "states", "run-2026-02-04-summary.json"),
      runDir: path.join(repoPath, ".otto", "runs", "2026-02-04-summary"),
      lockFilePath: path.join(repoPath, ".otto", "locks", "run-2026-02-04-summary.json"),
      ticket: {
        date: "2026-02-04",
        slug: "summary",
        filePath: path.join(repoPath, ".otto", "tickets", "2026-02-04-summary.md"),
      },
      worktree: {
        worktreePath: repoPath,
        branchName: "otto-2026-02-04-summary",
        baseBranch: "main",
      },
      workflow: {
        phase: "execution",
        needsUserInput: false,
        taskQueue: [],
        taskAgentSessions: {},
        reviewerSessions: {},
        autoRetryCounts: {},
      },
    },
    runners: {
      lead: summarizeRunner,
      task: summarizeRunner,
      reviewer: summarizeRunner,
      summarize: summarizeRunner,
    },
    reminders: { techLead: [], task: [], reviewer: [] },
    events: {
      async append() {},
      async appendExec() {},
    },
  };
}

test("summarizeReport uses configured reportMaxChars in prompt", async () => {
  const repo = await fs.mkdtemp(path.join(os.tmpdir(), "otto-sum-report-"));
  const reportFilePath = path.join(repo, "report-task-1.md");
  await fs.writeFile(reportFilePath, "full report", "utf8");

  const prompts = [];
  const summarizeRunner = {
    async run(options) {
      prompts.push(options.prompt);
      const outputMatch = options.prompt.match(/<OUTPUT>\n([\s\S]*?)\n<\/OUTPUT>/);
      const summaryPath = outputMatch?.[1]?.trim();
      await fs.writeFile(summaryPath, "short summary", "utf8");
      return {
        success: true,
        sessionId: "sess-sum",
        outputText: "ok",
        timedOut: false,
        contextOverflow: false,
      };
    },
  };

  const runtime = makeRuntime(repo, summarizeRunner, {
    reportMaxChars: 123,
    maxAttempts: 1,
  });

  const summaryPath = await reportMod.summarizeReport({ runtime, reportFilePath });
  assert.equal(typeof summaryPath, "string");
  assert.match(prompts[0], /Keep it <= 123 characters\./);
});

test("summarizeReview honors configured maxAttempts", async () => {
  const repo = await fs.mkdtemp(path.join(os.tmpdir(), "otto-sum-review-"));
  const reviewFilePath = path.join(repo, "review-task-1.md");
  await fs.writeFile(reviewFilePath, "review content", "utf8");

  let calls = 0;
  const summarizeRunner = {
    async run() {
      calls += 1;
      return {
        success: true,
        sessionId: null,
        outputText: "ok",
        timedOut: false,
        contextOverflow: false,
      };
    },
  };

  const runtime = makeRuntime(repo, summarizeRunner, {
    reviewMaxChars: 77,
    maxAttempts: 3,
  });

  const summaryPath = await reviewMod.summarizeReview({ runtime, reviewFilePath });
  assert.equal(summaryPath, null);
  assert.equal(calls, 3);
});

test("summarizeReport deletes over-limit summary after retries", async () => {
  const repo = await fs.mkdtemp(path.join(os.tmpdir(), "otto-sum-overlimit-"));
  const reportFilePath = path.join(repo, "report-task-9.md");
  await fs.writeFile(reportFilePath, "report content", "utf8");

  let summaryPath = null;
  const summarizeRunner = {
    async run(options) {
      if (!summaryPath) {
        const outputMatch = options.prompt.match(/<OUTPUT>\n([\s\S]*?)\n<\/OUTPUT>/);
        summaryPath = outputMatch?.[1]?.trim() ?? null;
      }
      if (summaryPath) {
        await fs.writeFile(summaryPath, "X".repeat(120), "utf8");
      }
      return {
        success: true,
        sessionId: "sess-over",
        outputText: "<OK>",
        timedOut: false,
        contextOverflow: false,
      };
    },
  };

  const runtime = makeRuntime(repo, summarizeRunner, {
    reportMaxChars: 10,
    maxAttempts: 2,
  });

  const result = await reportMod.summarizeReport({ runtime, reportFilePath });
  assert.equal(result, null);
  assert.equal(typeof summaryPath, "string");
  await assert.rejects(() => fs.stat(summaryPath));
});
