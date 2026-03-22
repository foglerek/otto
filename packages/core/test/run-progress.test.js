import assert from "node:assert/strict";
import { test } from "node:test";

import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { interopDefault: true });
const progress = await jiti(new URL("../src/cli/run-progress.ts", import.meta.url).href);
const output = await jiti(new URL("../src/cli/output.ts", import.meta.url).href);

test("run progress reporter prints phase and run failures", () => {
  const stdoutChunks = [];
  const stderrChunks = [];
  const stdoutWrite = process.stdout.write;
  const stderrWrite = process.stderr.write;

  process.stdout.write = ((chunk) => {
    stdoutChunks.push(String(chunk));
    return true;
  });
  process.stderr.write = ((chunk) => {
    stderrChunks.push(String(chunk));
    return true;
  });

  try {
    progress.reportRunEventToTerminal({
      at: new Date().toISOString(),
      runId: "run-1",
      type: "phase_entered",
      data: { phase: "ticket-created" },
    });
    progress.reportRunEventToTerminal({
      at: new Date().toISOString(),
      runId: "run-1",
      type: "run_failed",
      data: { error: "boom" },
    });
    progress.reportExecEventToTerminal({
      at: new Date().toISOString(),
      runId: "run-1",
      label: "opencode:ticket-ingestion:lead",
      cmd: ["opencode", "run"],
      cwd: "/tmp/repo",
      exitCode: 0,
      timedOut: false,
      durationMs: 1500,
      stdoutBytes: 10,
      stderrBytes: 0,
    });
  } finally {
    process.stdout.write = stdoutWrite;
    process.stderr.write = stderrWrite;
  }

  assert.match(stdoutChunks.join(""), /\[phase\] ticket-created/);
  assert.match(stdoutChunks.join(""), /\[exec\] opencode:ticket-ingestion:lead \(ok, 1500ms\)/);
  assert.match(stderrChunks.join(""), /\[run failed\] boom/);
});

test("run progress reporter is silent in json mode", () => {
  const stdoutChunks = [];
  const stderrChunks = [];
  const stdoutWrite = process.stdout.write;
  const stderrWrite = process.stderr.write;

  process.stdout.write = ((chunk) => {
    stdoutChunks.push(String(chunk));
    return true;
  });
  process.stderr.write = ((chunk) => {
    stderrChunks.push(String(chunk));
    return true;
  });

  output.setJsonOutputMode(true);
  try {
    progress.reportRunEventToTerminal({
      at: new Date().toISOString(),
      runId: "run-1",
      type: "phase_entered",
      data: { phase: "ticket-created" },
    });
    progress.reportRunEventToTerminal({
      at: new Date().toISOString(),
      runId: "run-1",
      type: "run_failed",
      data: { error: "boom" },
    });
    progress.reportExecEventToTerminal({
      at: new Date().toISOString(),
      runId: "run-1",
      label: "opencode:ticket-ingestion:lead",
      cmd: ["opencode", "run"],
      cwd: "/tmp/repo",
      exitCode: 0,
      timedOut: false,
      durationMs: 1500,
      stdoutBytes: 10,
      stderrBytes: 0,
    });
  } finally {
    output.resetJsonOutputMode();
    process.stdout.write = stdoutWrite;
    process.stderr.write = stderrWrite;
  }

  assert.equal(stdoutChunks.join(""), "");
  assert.equal(stderrChunks.join(""), "");
});
