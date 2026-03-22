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

function makeExecSequence(results, calls) {
  let index = 0;
  return {
    async run(cmd, options) {
      calls.push({ cmd, options });
      const next = results[Math.min(index, results.length - 1)];
      index += 1;
      return next;
    },
  };
}

function line(payload) {
  return `${JSON.stringify(payload)}\n`;
}

test("opencode runner builds command and parses result", async () => {
  const runner = mod.createOpencodeCliRunner({
    default: { model: "openai/gpt-5.3-codex" },
    byRole: {
      summarize: {
        variant: "high",
        settingsInline: { style: "brief" },
        extraArgs: ["--dangerous"],
        env: { CUSTOM_ENV: "1" },
      },
    },
  });

  const calls = [];
  const exec = makeExec(
    {
      exitCode: 0,
      stdout:
        line({ type: "status", session_id: "opencode-session-1" }) +
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
    cwd: "/tmp/repo/.worktrees/workflow-2026-03-22-summarize",
    exec,
  });

  assert.equal(out.success, true);
  assert.equal(out.sessionId, "opencode-session-1");
  assert.equal(out.outputText, "summary ok");

  const call = calls[0];
  assert.equal(call.cmd[0], "opencode");
  assert.equal(call.cmd.includes("run"), true);
  assert.equal(call.cmd.includes("--format"), true);
  assert.equal(call.cmd.includes("json"), true);
  assert.equal(call.cmd.includes("--dir"), true);
  assert.equal(call.cmd.includes("/tmp/repo"), true);
  assert.equal(call.cmd.includes("--model"), true);
  assert.equal(call.cmd.includes("openai/gpt-5.3-codex"), true);
  assert.equal(call.cmd.includes("--variant"), true);
  assert.equal(call.cmd.includes("high"), true);
  assert.equal(call.cmd.includes("--title"), true);
  assert.equal(call.cmd.includes("summarize"), true);
  assert.equal(call.cmd.includes("--dangerous"), true);
  assert.equal(call.cmd.at(-1), "Summarize report");
  assert.deepEqual(call.options.env, {
    CUSTOM_ENV: "1",
    OPENCODE_CONFIG_CONTENT: JSON.stringify({ style: "brief" }),
  });
  assert.equal(call.options.label, "opencode:summarize:summarize");
});

test("opencode runner omits --dir outside .worktrees cwd", async () => {
  const runner = mod.createOpencodeCliRunner();
  const calls = [];
  const exec = makeExec(
    {
      exitCode: 0,
      stdout: line({ type: "result", result: "ok" }),
      stderr: "",
      timedOut: false,
    },
    calls,
  );

  const out = await runner.run({
    role: "task",
    phaseName: "execution",
    prompt: "do thing",
    cwd: "/tmp/repo",
    exec,
  });

  assert.equal(out.success, true);
  assert.equal(calls[0].cmd.includes("--dir"), false);
});

test("opencode runner includes session continuation flag", async () => {
  const runner = mod.createOpencodeCliRunner();
  const calls = [];
  const exec = makeExec(
    {
      exitCode: 0,
      stdout: line({ type: "result", result: "continued", sessionId: "s-2" }),
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
  assert.equal(calls[0].cmd.includes("--session"), true);
  assert.equal(calls[0].cmd.includes("existing-session"), true);
});

test("opencode runner maps ENOENT to friendly error", async () => {
  const runner = mod.createOpencodeCliRunner();
  const calls = [];
  const exec = makeExec(
    {
      exitCode: 1,
      stdout: "",
      stderr: "spawn opencode ENOENT",
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
  assert.match(out.error ?? "", /OpenCode CLI not found/);
});

test("opencode runner flags context overflow from error result", async () => {
  const runner = mod.createOpencodeCliRunner();
  const calls = [];
  const exec = makeExec(
    {
      exitCode: 1,
      stdout:
        line({ type: "status", session_id: "s-ctx" }) +
        line({ type: "result", result: "prompt too long", is_error: true }),
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
  assert.equal(out.sessionId, "s-ctx");
  assert.equal(out.contextOverflow, true);
  assert.match(out.error ?? "", /prompt too long/i);
});

test("opencode runner carries timeout metadata", async () => {
  const runner = mod.createOpencodeCliRunner();
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

test("opencode runner treats internal schema failure as error", async () => {
  const runner = mod.createOpencodeCliRunner();
  const calls = [];
  const exec = makeExec(
    {
      exitCode: 0,
      stdout:
        "schema validation failure stack trace:\n" +
        "      at createUserMessage (/$bunfs/root/src/index.js:242039:35)\n",
      stderr:
        "ZodError: Invalid string: must start with \"prt\"\n",
      timedOut: false,
    },
    calls,
  );

  const out = await runner.run({
    role: "lead",
    phaseName: "ticket-ingestion",
    prompt: "plan",
    cwd: process.cwd(),
    exec,
  });

  assert.equal(out.success, false);
  assert.match(out.error ?? "", /schema validation failure|zoderror/i);
  assert.equal(calls.length, 2);
  assert.equal(typeof calls[1].options.env?.XDG_CONFIG_HOME, "string");
});

test("opencode runner recovers from prt schema failure with isolated config retry", async () => {
  const runner = mod.createOpencodeCliRunner();
  const calls = [];
  const exec = makeExecSequence(
    [
      {
        exitCode: 0,
        stdout:
          "schema validation failure stack trace:\n" +
          "      at createUserMessage (/$bunfs/root/src/index.js:242039:35)\n",
        stderr:
          "ZodError: Invalid string: must start with \"prt\"\n",
        timedOut: false,
      },
      {
        exitCode: 0,
        stdout: line({ type: "result", result: "ok", session_id: "retry-sid" }),
        stderr: "",
        timedOut: false,
      },
    ],
    calls,
  );

  const out = await runner.run({
    role: "lead",
    phaseName: "ticket-ingestion",
    prompt: "plan",
    cwd: process.cwd(),
    exec,
  });

  assert.equal(out.success, true);
  assert.equal(out.outputText, "ok");
  assert.equal(out.sessionId, "retry-sid");
  assert.equal(calls.length, 2);
  assert.equal(calls[0].options.env?.XDG_CONFIG_HOME, undefined);
  assert.equal(typeof calls[1].options.env?.XDG_CONFIG_HOME, "string");
});

test("opencode runner requires final JSON result record", async () => {
  const runner = mod.createOpencodeCliRunner();
  const calls = [];
  const exec = makeExec(
    {
      exitCode: 0,
      stdout: line({ type: "status", session_id: "s-only-status" }),
      stderr: "",
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
  assert.match(out.error ?? "", /did not emit a final json result/i);
});
