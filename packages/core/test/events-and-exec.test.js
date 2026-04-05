import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";

import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { interopDefault: true });
const events = await jiti(new URL("../src/workflow/events.ts", import.meta.url).href);
const execMod = await jiti(new URL("../src/exec.ts", import.meta.url).href);

test("run event logger writes events and exec jsonl files", async () => {
  const runDir = await fs.mkdtemp(path.join(os.tmpdir(), "otto-events-"));
  const logger = events.createRunEventLogger({
    runId: "2026-02-03-test",
    runDir,
  });

  await events.emitRunEvent({
    logger,
    runId: "2026-02-03-test",
    type: "run_started",
    data: { phase: "ticket-created" },
  });
  await logger.appendExec({
    at: new Date().toISOString(),
    runId: "2026-02-03-test",
    execId: "exec-1",
    label: "demo",
    cmd: ["node", "-v"],
    cwd: runDir,
    exitCode: 0,
    timedOut: false,
    durationMs: 12,
    stdoutBytes: 10,
    stderrBytes: 0,
  });

  const eventsJsonl = await fs.readFile(path.join(runDir, "events.jsonl"), "utf8");
  const execJsonl = await fs.readFile(path.join(runDir, "exec.jsonl"), "utf8");

  const eventRow = JSON.parse(eventsJsonl.trim());
  const execRow = JSON.parse(execJsonl.trim());

  assert.equal(eventRow.type, "run_started");
  assert.equal(eventRow.runId, "2026-02-03-test");
  assert.equal(execRow.label, "demo");
  assert.equal(execRow.execId, "exec-1");
  assert.equal(execRow.exitCode, 0);
});

test("node exec emits onResult telemetry", async () => {
  const seen = [];
  const exec = execMod.createNodeExec({
    onResult: (event) => {
      seen.push(event);
    },
  });

  const result = await exec.run(
    [process.execPath, "-e", "console.log('hello'); console.error('warn')"],
    {
      cwd: process.cwd(),
      label: "unit-exec",
    },
  );

  assert.equal(result.exitCode, 0);
  assert.equal(seen.length, 1);
  assert.equal(seen[0].label, "unit-exec");
  assert.equal(seen[0].execId, "exec-1");
  assert.equal(seen[0].exitCode, 0);
  assert.equal(Array.isArray(seen[0].cmd), true);
  assert.equal(typeof seen[0].durationMs, "number");
});
