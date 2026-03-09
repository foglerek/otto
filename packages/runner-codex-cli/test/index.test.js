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

test("codex runner builds command and parses result", async () => {
  const runner = mod.createCodexCliRunner({
    default: { model: "gpt-5-codex" },
    byRole: {
      summarize: {
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
      stdout: line({
        type: "result",
        result: "summary ok",
        session_id: "codex-session-1",
      }),
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
    jsonSchema: { type: "object" },
  });

  assert.equal(out.success, true);
  assert.equal(out.sessionId, "codex-session-1");
  assert.equal(out.outputText, "summary ok");

  const call = calls[0];
  assert.equal(call.cmd[0], "codex");
  assert.equal(call.cmd.includes("exec"), true);
  assert.equal(call.cmd.includes("--json"), true);
  assert.equal(call.cmd.includes("--model"), true);
  assert.equal(call.cmd.includes("gpt-5-codex"), true);
  assert.equal(call.cmd.includes("--settings"), true);
  assert.deepEqual(JSON.parse(call.cmd[call.cmd.indexOf("--settings") + 1]), {
    style: "brief",
  });
  assert.equal(call.cmd.includes("--json-schema"), true);
  assert.equal(call.cmd.includes("--dangerous"), true);
  assert.deepEqual(call.options.env, { CUSTOM_ENV: "1" });
  assert.equal(call.options.label, "codex:summarize:summarize");
});

test("codex runner maps ENOENT to friendly error", async () => {
  const runner = mod.createCodexCliRunner();
  const calls = [];
  const exec = makeExec(
    {
      exitCode: 1,
      stdout: "",
      stderr: "spawn codex ENOENT",
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
  assert.match(out.error ?? "", /Codex CLI not found/);
});

test("codex runner flags context overflow from error result", async () => {
  const runner = mod.createCodexCliRunner();
  const calls = [];
  const exec = makeExec(
    {
      exitCode: 1,
      stdout:
        line({ type: "status", session_id: "s-ctx" }) +
        line({ type: "result", result: "Prompt is too long", is_error: true }),
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
  assert.match(out.error ?? "", /Prompt is too long/i);
});
