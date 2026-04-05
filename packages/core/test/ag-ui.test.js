import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";

import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { interopDefault: true });
const agUi = await jiti(new URL("../src/ag-ui.ts", import.meta.url).href);

test("ag-ui logger writes translated lifecycle and exec events", async () => {
  const runDir = await fs.mkdtemp(path.join(os.tmpdir(), "otto-ag-ui-"));
  const logger = agUi.createAgUiEventLogger({ runDir });

  await logger.appendMany(
    agUi.mapRunEventToAgUi({
      at: new Date().toISOString(),
      runId: "2026-04-05-ag-ui",
      type: "run_started",
      data: { stateFilePath: "/tmp/state.json" },
    }),
  );
  await logger.appendMany(
    agUi.mapExecStartToAgUi({
      at: new Date().toISOString(),
      runId: "2026-04-05-ag-ui",
      execId: "exec-1",
      label: "demo",
      cmd: ["node", "-v"],
      cwd: runDir,
    }),
  );
  await logger.appendMany(
    agUi.mapExecEventToAgUi({
      at: new Date().toISOString(),
      runId: "2026-04-05-ag-ui",
      execId: "exec-1",
      label: "demo",
      cmd: ["node", "-v"],
      cwd: runDir,
      exitCode: 0,
      timedOut: false,
      durationMs: 12,
      stdoutBytes: 10,
      stderrBytes: 0,
      stdoutPreview: "v22",
    }),
  );

  const raw = await fs.readFile(path.join(runDir, "ag-ui-events.jsonl"), "utf8");
  const rows = raw
    .trim()
    .split(/\r?\n/)
    .map((line) => JSON.parse(line));

  assert.equal(rows[0].type, "RUN_STARTED");
  assert.equal(rows[0].runId, "2026-04-05-ag-ui");
  assert.equal(rows[1].type, "TOOL_CALL_START");
  assert.equal(rows[1].toolCallId, "exec-1");
  assert.equal(rows[2].type, "TOOL_CALL_ARGS");
  assert.equal(rows[3].type, "CUSTOM");
  assert.equal(rows[4].type, "TOOL_CALL_END");
  assert.equal(rows[5].type, "TOOL_CALL_RESULT");

  await fs.rm(runDir, { recursive: true, force: true });
});
