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
  assert.equal(call.cmd.includes("--json-schema"), false);
  assert.equal(call.cmd.includes("--dangerous"), true);
  assert.deepEqual(call.options.env, { CUSTOM_ENV: "1" });
  assert.equal(call.options.label, "codex:summarize:summarize");
});

test("codex runner configures writable roots when cwd is worktree", async () => {
  const runner = mod.createCodexCliRunner();
  const calls = [];
  const exec = makeExec(
    {
      exitCode: 0,
      stdout:
        line({ type: "thread.started", thread_id: "thread-1" }) +
        line({
          type: "item.completed",
          item: { type: "agent_message", text: "done <OK>" },
        }) +
        line({ type: "turn.completed" }),
      stderr: "",
      timedOut: false,
    },
    calls,
  );

  const out = await runner.run({
    role: "lead",
    phaseName: "ticket-ingestion",
    prompt: "plan",
    cwd: "/Users/alex/src/jarvis/.worktrees/workflow-2026-03-22-demo",
    exec,
  });

  assert.equal(out.success, true);
  const call = calls[0];
  const configIndex = call.cmd.indexOf("-c");
  assert.notEqual(configIndex, -1);
  const configArg = call.cmd[configIndex + 1];
  assert.match(configArg, /sandbox_workspace_write\.writable_roots=/);
  assert.match(configArg, /"\/Users\/alex\/src\/jarvis\/.otto"/);
  assert.match(
    configArg,
    /"\/Users\/alex\/src\/jarvis\/.worktrees\/workflow-2026-03-22-demo"/,
  );
});

test("codex runner resumes when session id provided", async () => {
  const runner = mod.createCodexCliRunner();
  const calls = [];
  const exec = makeExec(
    {
      exitCode: 0,
      stdout:
        line({ type: "thread.started", thread_id: "thread-2" }) +
        line({
          type: "item.completed",
          item: { type: "agent_message", text: "resume ok" },
        }) +
        line({ type: "turn.completed" }),
      stderr: "",
      timedOut: false,
    },
    calls,
  );

  const out = await runner.run({
    role: "lead",
    phaseName: "decision-cards",
    prompt: "continue",
    cwd: process.cwd(),
    sessionId: "thread-1",
    exec,
  });

  assert.equal(out.success, true);
  assert.equal(out.sessionId, "thread-2");
  assert.deepEqual(calls[0].cmd.slice(0, 5), [
    "codex",
    "exec",
    "resume",
    "--json",
    "thread-1",
  ]);
  assert.equal(calls[0].cmd.includes("--json-schema"), false);
});

test("codex runner resumes with writable roots config when cwd is worktree", async () => {
  const runner = mod.createCodexCliRunner();
  const calls = [];
  const exec = makeExec(
    {
      exitCode: 0,
      stdout:
        line({ type: "thread.started", thread_id: "thread-3" }) +
        line({
          type: "item.completed",
          item: { type: "agent_message", text: "resume with add-dir" },
        }) +
        line({ type: "turn.completed" }),
      stderr: "",
      timedOut: false,
    },
    calls,
  );

  const out = await runner.run({
    role: "lead",
    phaseName: "task-splitting",
    prompt: "continue",
    cwd: "/Users/alex/src/jarvis/.worktrees/workflow-2026-03-22-demo",
    sessionId: "thread-1",
    exec,
  });

  assert.equal(out.success, true);
  const configIndex = calls[0].cmd.indexOf("-c");
  assert.notEqual(configIndex, -1);
  assert.match(
    calls[0].cmd[configIndex + 1],
    /"\/Users\/alex\/src\/jarvis\/.otto"/,
  );
  assert.deepEqual(calls[0].cmd.slice(configIndex + 2, configIndex + 7), [
    "exec",
    "resume",
    "--json",
    "thread-1",
    "--model",
  ]);
});

test("codex runner parses terminal agent_message stream output", async () => {
  const runner = mod.createCodexCliRunner();
  const calls = [];
  const exec = makeExec(
    {
      exitCode: 0,
      stdout:
        line({ type: "thread.started", thread_id: "thread-stream" }) +
        line({
          type: "item.completed",
          item: { type: "agent_message", text: "created plan <OK>" },
        }) +
        line({ type: "turn.completed" }),
      stderr: "",
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

  assert.equal(out.success, true);
  assert.equal(out.outputText, "created plan <OK>");
  assert.equal(out.sessionId, "thread-stream");
});

test("codex runner fails when terminal json event is missing", async () => {
  const runner = mod.createCodexCliRunner();
  const calls = [];
  const exec = makeExec(
    {
      exitCode: 0,
      stdout: line({ type: "thread.started", thread_id: "thread-no-end" }),
      stderr: "",
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
  assert.match(out.error ?? "", /terminal JSON event/i);
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
