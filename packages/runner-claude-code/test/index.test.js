import assert from "node:assert/strict";
import { test } from "node:test";

import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { interopDefault: true });
const mod = await jiti(new URL("../src/index.ts", import.meta.url).href);

function makeExec(result, capture) {
  return {
    async run(cmd, options) {
      capture.push({ cmd, options });
      return result;
    },
  };
}

function resultLine(payload) {
  return `${JSON.stringify(payload)}\n`;
}

test("runner builds claude command with resume + schema", async () => {
  const runner = mod.createClaudeCodeRunner();
  const calls = [];
  const exec = makeExec(
    {
      exitCode: 0,
      stdout: resultLine({
        type: "result",
        result: "ok",
        is_error: false,
        session_id: "sess-1",
      }),
      stderr: "",
      timedOut: false,
    },
    calls,
  );

  const out = await runner.run({
    role: "projectLead",
    phaseName: "ticket-create",
    prompt: "hello",
    cwd: process.cwd(),
    exec,
    sessionId: "sess-0",
    jsonSchema: { type: "object" },
  });

  assert.equal(out.success, true);
  assert.equal(out.sessionId, "sess-1");
  assert.equal(out.outputText, "ok");

  const call = calls[0];
  assert.equal(call.cmd[0], "claude");
  assert.equal(call.options.stdin, "hello");
  assert.equal(call.options.label, "claude:ticket-create:projectLead");
  assert.deepEqual(call.options.env, {
    MAX_THINKING_TOKENS: "31999",
    CLAUDE_CODE_MAX_OUTPUT_TOKENS: "32000",
  });
  assert.equal(call.cmd.includes("--resume"), true);
  assert.equal(call.cmd.includes("sess-0"), true);
  assert.equal(call.cmd.includes("--json-schema"), true);
});

test("runner returns missing cli error when no final result and ENOENT", async () => {
  const runner = mod.createClaudeCodeRunner();
  const calls = [];
  const exec = makeExec(
    {
      exitCode: 1,
      stdout: "",
      stderr: "spawn claude ENOENT",
      timedOut: false,
    },
    calls,
  );

  const out = await runner.run({
    role: "lead",
    phaseName: "plan",
    prompt: "hello",
    cwd: process.cwd(),
    exec,
  });

  assert.equal(out.success, false);
  assert.match(out.error ?? "", /CLI not found/);
});

test("runner surfaces result errors and context overflow", async () => {
  const runner = mod.createClaudeCodeRunner();
  const calls = [];
  const stdout =
    resultLine({ type: "status", session_id: "sess-ctx" }) +
    resultLine({
      type: "result",
      result: "prompt is too long",
      is_error: true,
    });
  const exec = makeExec(
    {
      exitCode: 1,
      stdout,
      stderr: "",
      timedOut: false,
    },
    calls,
  );

  const out = await runner.run({
    role: "reviewer",
    phaseName: "review",
    prompt: "hello",
    cwd: process.cwd(),
    exec,
  });

  assert.equal(out.success, false);
  assert.equal(out.sessionId, "sess-ctx");
  assert.equal(out.outputText, "prompt is too long");
  assert.equal(out.contextOverflow, true);
});

test("summarize role uses haiku model and no thinking env", async () => {
  const runner = mod.createClaudeCodeRunner();
  const calls = [];
  const exec = makeExec(
    {
      exitCode: 0,
      stdout: resultLine({ type: "result", result: "summary", is_error: false }),
      stderr: "",
      timedOut: false,
    },
    calls,
  );

  const out = await runner.run({
    role: "summarize",
    phaseName: "summarize",
    prompt: "hello",
    cwd: process.cwd(),
    exec,
  });

  assert.equal(out.success, true);
  const call = calls[0];
  assert.equal(call.cmd.includes("claude-haiku-4-5"), true);
  assert.deepEqual(call.options.env, {});
});

test("runner options override model config by role", async () => {
  const runner = mod.createClaudeCodeRunner({
    default: {
      maxOutputTokens: 2048,
    },
    byRole: {
      summarize: {
        model: "claude-sonnet-4-5",
        thinking: true,
        maxThinkingTokens: 123,
        extraArgs: ["--foo", "bar"],
        env: { CUSTOM_FLAG: "1" },
      },
    },
  });

  const calls = [];
  const exec = makeExec(
    {
      exitCode: 0,
      stdout: resultLine({ type: "result", result: "ok", is_error: false }),
      stderr: "",
      timedOut: false,
    },
    calls,
  );

  const out = await runner.run({
    role: "summarize",
    phaseName: "summarize",
    prompt: "hello",
    cwd: process.cwd(),
    exec,
  });

  assert.equal(out.success, true);
  const call = calls[0];
  assert.equal(call.cmd.includes("claude-sonnet-4-5"), true);
  assert.equal(call.cmd.includes("--foo"), true);
  assert.equal(call.cmd.includes("bar"), true);
  assert.deepEqual(call.options.env, {
    MAX_THINKING_TOKENS: "123",
    CLAUDE_CODE_MAX_OUTPUT_TOKENS: "2048",
    CUSTOM_FLAG: "1",
  });
});
