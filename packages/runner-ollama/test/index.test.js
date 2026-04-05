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

test("ollama runner builds command and parses streamed json", async () => {
  const runner = mod.createOllamaRunner({
    byRole: {
      task: {
        model: "qwen2.5-coder:14b",
        extraArgs: ["--verbose"],
        env: { OLLAMA_HOST: "http://localhost:11434" },
      },
    },
  });

  const calls = [];
  const exec = makeExec(
    {
      exitCode: 0,
      stdout:
        line({ response: "hello " }) +
        line({ response: "world" }) +
        line({ done: true }),
      stderr: "",
      timedOut: false,
    },
    calls,
  );

  const out = await runner.run({
    role: "task",
    phaseName: "execution",
    prompt: "Say hello",
    cwd: process.cwd(),
    exec,
  });

  assert.equal(out.success, true);
  assert.equal(out.outputText, "hello world");

  const call = calls[0];
  assert.deepEqual(call.cmd, [
    "ollama",
    "run",
    "qwen2.5-coder:14b",
    "--verbose",
    "Say hello",
  ]);
  assert.equal(call.options.label, "ollama:execution:task");
  assert.deepEqual(call.options.env, { OLLAMA_HOST: "http://localhost:11434" });
});

test("ollama runner maps ENOENT to friendly error", async () => {
  const runner = mod.createOllamaRunner();
  const calls = [];
  const exec = makeExec(
    {
      exitCode: 1,
      stdout: "",
      stderr: "spawn ollama ENOENT",
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
  assert.match(out.error ?? "", /Ollama CLI not found/);
});

test("ollama runner flags overflow from stderr", async () => {
  const runner = mod.createOllamaRunner();
  const calls = [];
  const exec = makeExec(
    {
      exitCode: 1,
      stdout: "",
      stderr: "maximum context length exceeded",
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
  assert.equal(out.contextOverflow, true);
});

test("ollama runner carries timeout metadata", async () => {
  const runner = mod.createOllamaRunner();
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

test("ollama runner emits AG-UI assistant events", async () => {
  const runner = mod.createOllamaRunner();
  const calls = [];
  const events = [];
  const exec = makeExec(
    {
      exitCode: 0,
      stdout: line({ response: "hello ollama" }) + line({ done: true }),
      stderr: "",
      timedOut: false,
    },
    calls,
  );

  await runner.run({
    role: "task",
    phaseName: "execution",
    prompt: "Say hello",
    cwd: process.cwd(),
    exec,
    onEvent: async (event) => {
      events.push(event);
    },
  });

  assert.deepEqual(events.map((event) => event.type), [
    "TEXT_MESSAGE_START",
    "TEXT_MESSAGE_CONTENT",
    "TEXT_MESSAGE_END",
  ]);
  assert.equal(events[1].delta, "hello ollama");
});
