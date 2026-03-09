import assert from "node:assert/strict";
import { test } from "node:test";

import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { interopDefault: true });
const mod = await jiti(new URL("../src/index.ts", import.meta.url).href);

function makeExec(result, calls) {
  return {
    async run(cmd, options) {
      calls.push({ cmd, options });
      return result;
    },
  };
}

function line(payload) {
  return `${JSON.stringify(payload)}\n`;
}

test("gemini runner builds command and parses result", async () => {
  const runner = mod.createGeminiCliRunner({
    byRole: {
      summarize: {
        model: "gemini-2.5-flash",
        extraArgs: ["--sandbox"],
        env: { GEMINI_API_KEY: "test-key" },
      },
    },
  });

  const calls = [];
  const exec = makeExec(
    {
      exitCode: 0,
      stdout:
        line({ type: "status", session_id: "gemini-session-1" }) +
        line({ type: "result", result: "summary ok" }),
      stderr: "",
      timedOut: false,
    },
    calls,
  );

  const out = await runner.run({
    role: "summarize",
    phaseName: "summarize",
    prompt: "Summarize report",
    cwd: process.cwd(),
    exec,
  });

  assert.equal(out.success, true);
  assert.equal(out.sessionId, "gemini-session-1");
  assert.equal(out.outputText, "summary ok");

  const call = calls[0];
  assert.equal(call.cmd[0], "gemini");
  assert.equal(call.cmd.includes("--output-format"), true);
  assert.equal(call.cmd.includes("stream-json"), true);
  assert.equal(call.cmd.includes("--model"), true);
  assert.equal(call.cmd.includes("gemini-2.5-flash"), true);
  assert.equal(call.cmd.includes("--yolo"), true);
  assert.equal(call.cmd.includes("--sandbox"), true);
  assert.equal(call.options.stdin, "Summarize report");
  assert.equal(call.options.label, "gemini:summarize:summarize");
  assert.deepEqual(call.options.env, { GEMINI_API_KEY: "test-key" });
});

test("gemini runner includes resume flag", async () => {
  const runner = mod.createGeminiCliRunner();
  const calls = [];
  const exec = makeExec(
    {
      exitCode: 0,
      stdout: line({ type: "result", result: "continued", sessionId: "g-2" }),
      stderr: "",
      timedOut: false,
    },
    calls,
  );

  const out = await runner.run({
    role: "task",
    phaseName: "execution",
    prompt: "Continue",
    cwd: process.cwd(),
    sessionId: "existing-session",
    exec,
  });

  assert.equal(out.success, true);
  assert.equal(calls[0].cmd.includes("--resume"), true);
  assert.equal(calls[0].cmd.includes("existing-session"), true);
});

test("gemini runner maps ENOENT to friendly error", async () => {
  const runner = mod.createGeminiCliRunner();
  const calls = [];
  const exec = makeExec(
    {
      exitCode: 1,
      stdout: "",
      stderr: "spawn gemini ENOENT",
      timedOut: false,
    },
    calls,
  );

  const out = await runner.run({
    role: "task",
    phaseName: "execution",
    prompt: "do thing",
    cwd: process.cwd(),
    exec,
  });

  assert.equal(out.success, false);
  assert.match(out.error ?? "", /Gemini CLI not found/);
});

test("gemini runner flags context overflow from error result", async () => {
  const runner = mod.createGeminiCliRunner();
  const calls = [];
  const exec = makeExec(
    {
      exitCode: 1,
      stdout:
        line({ type: "status", session_id: "g-ctx" }) +
        line({ type: "result", result: "token limit exceeded", is_error: true }),
      stderr: "",
      timedOut: false,
    },
    calls,
  );

  const out = await runner.run({
    role: "lead",
    phaseName: "plan",
    prompt: "plan",
    cwd: process.cwd(),
    exec,
  });

  assert.equal(out.success, false);
  assert.equal(out.sessionId, "g-ctx");
  assert.equal(out.contextOverflow, true);
  assert.match(out.error ?? "", /token limit/i);
});

test("gemini runner carries timeout metadata", async () => {
  const runner = mod.createGeminiCliRunner();
  const calls = [];
  const exec = makeExec(
    {
      exitCode: 1,
      stdout: "",
      stderr: "Timed out",
      timedOut: true,
    },
    calls,
  );

  const out = await runner.run({
    role: "task",
    phaseName: "execution",
    prompt: "do thing",
    cwd: process.cwd(),
    exec,
  });

  assert.equal(out.success, false);
  assert.equal(out.timedOut, true);
});
