import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";

import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { interopDefault: true });
const failure = await jiti(
  new URL("../src/workflow/task-failure.ts", import.meta.url).href,
);

const writeFile = async (dir, name) => {
  await fs.writeFile(path.join(dir, name), "data", "utf8");
};

test("archiveFailedTaskArtifacts renames matching artifacts", async () => {
  const runDir = await fs.mkdtemp(path.join(os.tmpdir(), "otto-failed-"));
  const baseTaskName = "task-1-foo";
  const timestamp = "2026-02-01T12-00-00Z";

  const files = [
    "task-1-foo.md",
    "task-1-foo-remediation-1.md",
    "report-task-1-foo.md",
    "review-task-1-foo.md",
    "outcome-task-1-foo.md",
    "summary-report-task-1-foo.md",
    "summary-review-task-1-foo.md",
    "report-task-1-foo-remediation-1.md",
    "summary-review-task-1-foo-remediation-1.md",
    "task-2-bar.md",
    "report-task-2-bar.md",
    "failed-2026-01-01T00-00-00Z-report-task-1-foo.md",
  ];

  await Promise.all(files.map((name) => writeFile(runDir, name)));

  await failure.archiveFailedTaskArtifacts({
    runDir,
    baseTaskName,
    timestamp,
  });

  const prefix = `failed-${timestamp}-`;
  const renamed = [
    "task-1-foo-remediation-1.md",
    "report-task-1-foo.md",
    "review-task-1-foo.md",
    "outcome-task-1-foo.md",
    "summary-report-task-1-foo.md",
    "summary-review-task-1-foo.md",
    "report-task-1-foo-remediation-1.md",
    "summary-review-task-1-foo-remediation-1.md",
  ].map((name) => `${prefix}${name}`);

  const listing = new Set(await fs.readdir(runDir));

  assert.ok(listing.has("task-1-foo.md"));
  assert.ok(listing.has("task-2-bar.md"));
  assert.ok(listing.has("report-task-2-bar.md"));
  assert.ok(listing.has("failed-2026-01-01T00-00-00Z-report-task-1-foo.md"));

  for (const name of renamed) {
    assert.ok(listing.has(name));
  }

  for (const name of renamed.map((name) => name.replace(prefix, ""))) {
    assert.ok(!listing.has(name));
  }
});

test("clearTaskSessionsForBaseTask removes base task sessions", () => {
  const baseTaskPath = "/tmp/task-1-foo.md";
  const state = {
    workflow: {
      taskAgentSessions: {
        [baseTaskPath]: "session-1",
        "/tmp/task-2-bar.md": "session-2",
      },
      reviewerSessions: {
        [baseTaskPath]: "review-1",
        "/tmp/task-2-bar.md": null,
      },
    },
  };

  const changed = failure.clearTaskSessionsForBaseTask(state, baseTaskPath);

  assert.equal(changed, true);
  assert.equal(state.workflow.taskAgentSessions[baseTaskPath], undefined);
  assert.equal(state.workflow.reviewerSessions[baseTaskPath], undefined);
  assert.equal(
    state.workflow.taskAgentSessions["/tmp/task-2-bar.md"],
    "session-2",
  );
  assert.equal(state.workflow.reviewerSessions["/tmp/task-2-bar.md"], null);
});
