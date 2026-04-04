import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";

import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { interopDefault: true });
const web = await jiti(new URL("../src/services/web.ts", import.meta.url).href);

async function makeRepo() {
  const repo = await fs.mkdtemp(path.join(process.cwd(), ".tmp-otto-web-"));
  await fs.writeFile(
    path.join(repo, "otto.config.ts"),
    [
      'import { defineOttoConfig } from "@otto/config";',
      'import { createEchoRunner } from "@otto/runner-echo";',
      "",
      "export default defineOttoConfig({",
      '  worktree: {',
      '    baseBranch: "main",',
      '    branchNamer: ({ ticket }) => `otto-${ticket.date}-${ticket.slug}`,',
      '    adapter: {',
      '      getMainRepoPath: async (cwd) => cwd,',
      '      createWorktree: async () => ({ worktreePath: "/tmp/wt" }),',
      '      removeWorktree: async () => {},',
      '    },',
      '    afterCreate: async () => {},',
      '  },',
      '  runners: { default: createEchoRunner() },',
      '  subagents: { enabled: true, maxConcurrent: 2 },',
      "});",
      "",
    ].join("\n"),
    "utf8",
  );

  await fs.mkdir(path.join(repo, ".otto", "tickets"), { recursive: true });
  await fs.mkdir(path.join(repo, ".otto", "states"), { recursive: true });
  await fs.mkdir(path.join(repo, ".otto", "runs", "2026-04-04-web-dashboard"), {
    recursive: true,
  });

  return repo;
}

test("web services summarize dashboard and run details", async () => {
  const repo = await makeRepo();
  const runId = "2026-04-04-web-dashboard";
  const artifactRootDir = path.join(repo, ".otto");
  const stateFilePath = path.join(artifactRootDir, "states", `run-${runId}.json`);
  const runDir = path.join(artifactRootDir, "runs", runId);
  const ticketFilePath = path.join(artifactRootDir, "tickets", `${runId}.md`);

  await fs.writeFile(ticketFilePath, "# Ticket\n\nBuild a web dashboard.\n", "utf8");
  await fs.writeFile(path.join(runDir, "plan.md"), "# Plan\n\n- First slice\n", "utf8");
  await fs.writeFile(path.join(runDir, "decision-cards.json"), '{"schemaVersion":"1"}\n', "utf8");
  await fs.writeFile(path.join(runDir, "final-report.md"), "# Final report\n\nRead-only web slice shipped.\n", "utf8");
  await fs.writeFile(
    path.join(runDir, "events.jsonl"),
    [
      JSON.stringify({ at: new Date().toISOString(), runId, type: "phase_entered", data: { phase: "execution" } }),
      JSON.stringify({ at: new Date().toISOString(), runId, type: "run_completed", data: { ok: true } }),
      "",
    ].join("\n"),
    "utf8",
  );
  await fs.writeFile(
    path.join(runDir, "exec.jsonl"),
    [
      JSON.stringify({ at: new Date().toISOString(), runId, label: "echo:execution:task", cmd: ["echo"], cwd: repo, exitCode: 0, timedOut: false, durationMs: 42, stdoutBytes: 10, stderrBytes: 0 }),
      "",
    ].join("\n"),
    "utf8",
  );
  await fs.writeFile(
    path.join(artifactRootDir, "states", "onboarding.json"),
    JSON.stringify({ kind: "otto.onboarding", version: 1, status: "initialized" }, null, 2),
    "utf8",
  );

  const state = {
    kind: "otto.state",
    version: 1,
    runId,
    createdAt: new Date().toISOString(),
    configPath: path.join(repo, "otto.config.ts"),
    mainRepoPath: repo,
    artifactRootDir,
    stateFilePath,
    runDir,
    lockFilePath: path.join(artifactRootDir, "locks", `run-${runId}.json`),
    workflow: {
      phase: "cleanup",
      needsUserInput: false,
      taskQueue: [],
      taskAgentSessions: {},
      reviewerSessions: {},
      autoRetryCounts: {},
    },
    ticket: {
      date: "2026-04-04",
      slug: "web-dashboard",
      filePath: ticketFilePath,
    },
    worktree: {
      worktreePath: path.join(repo, ".worktrees", runId),
      branchName: `workflow-${runId}`,
      baseBranch: "main",
    },
  };
  await fs.writeFile(stateFilePath, JSON.stringify(state, null, 2), "utf8");

  const dashboard = await web.loadWebDashboardData(repo);
  assert.equal(dashboard.repoPath, repo);
  assert.equal(dashboard.defaultRunnerId, "echo");
  assert.equal(dashboard.subagentsEnabled, true);
  assert.equal(dashboard.ticketsCount, 1);
  assert.equal(dashboard.runCounts.total, 1);
  assert.equal(dashboard.runs[0].planAvailable, true);
  assert.equal(dashboard.runs[0].finalReportAvailable, true);

  const detail = await web.loadWebRunDetailData({ cwd: repo, runId });
  assert.equal(detail.summary.runId, runId);
  assert.equal(detail.artifacts.length, 4);
  assert.match(detail.artifacts[0].content, /Build a web dashboard/);
  assert.match(detail.artifacts[1].content, /First slice/);
  assert.match(detail.artifacts[3].content, /Read-only web slice shipped/);
  assert.equal(detail.recentEvents.length, 2);
  assert.equal(detail.recentExecs.length, 1);

  await fs.rm(repo, { recursive: true, force: true });
});
