import assert from "node:assert/strict";
import { test } from "node:test";

import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { interopDefault: true });
const mod = await jiti(new URL("../src/index.ts", import.meta.url).href);

test("claude sdk runner parses text response", async () => {
  let request;
  const runner = mod.createClaudeSdkRunner({
    byRole: {
      task: { model: "claude-3-5-sonnet-latest", maxTokens: 2048 },
    },
    clientFactory: async () => ({
      messages: {
        create: async (input) => {
          request = input;
          return {
            id: "msg_abc",
            content: [{ type: "text", text: "implemented" }],
          };
        },
      },
    }),
  });

  const out = await runner.run({
    role: "task",
    phaseName: "execution",
    prompt: "Do the task",
    cwd: process.cwd(),
    exec: { run: async () => ({ exitCode: 0, stdout: "", stderr: "", timedOut: false }) },
  });

  assert.equal(out.success, true);
  assert.equal(out.sessionId, "msg_abc");
  assert.equal(out.outputText, "implemented");
  assert.equal(request.model, "claude-3-5-sonnet-latest");
  assert.equal(request.max_tokens, 2048);
  assert.deepEqual(request.messages, [{ role: "user", content: "Do the task" }]);
});

test("claude sdk runner merges default and role overrides", async () => {
  let request;
  const runner = mod.createClaudeSdkRunner({
    default: { temperature: 0.2, systemPrompt: "System" },
    byRole: {
      summarize: { model: "claude-3-5-haiku-latest", maxTokens: 512 },
    },
    clientFactory: async () => ({
      messages: {
        create: async (input) => {
          request = input;
          return { id: "msg_sum", content: [{ type: "text", text: "ok" }] };
        },
      },
    }),
  });

  const out = await runner.run({
    role: "summarize",
    phaseName: "summarize",
    prompt: "Summarize",
    cwd: process.cwd(),
    exec: { run: async () => ({ exitCode: 0, stdout: "", stderr: "", timedOut: false }) },
  });

  assert.equal(out.success, true);
  assert.equal(request.model, "claude-3-5-haiku-latest");
  assert.equal(request.max_tokens, 512);
  assert.equal(request.system, "System");
  assert.equal(request.temperature, 0.2);
});

test("claude sdk runner reports unavailable sdk from factory", async () => {
  const runner = mod.createClaudeSdkRunner({
    clientFactory: async () => {
      throw new Error("Cannot find package '@anthropic-ai/sdk'");
    },
  });

  const out = await runner.run({
    role: "task",
    phaseName: "execution",
    prompt: "Do task",
    cwd: process.cwd(),
    exec: { run: async () => ({ exitCode: 0, stdout: "", stderr: "", timedOut: false }) },
  });

  assert.equal(out.success, false);
  assert.match(out.error ?? "", /anthropic/i);
});

test("claude sdk runner flags context overflow on error", async () => {
  const runner = mod.createClaudeSdkRunner({
    clientFactory: async () => ({
      messages: {
        create: async () => {
          throw new Error("prompt too long for context window");
        },
      },
    }),
  });

  const out = await runner.run({
    role: "lead",
    phaseName: "plan",
    prompt: "Plan",
    cwd: process.cwd(),
    exec: { run: async () => ({ exitCode: 0, stdout: "", stderr: "", timedOut: false }) },
  });

  assert.equal(out.success, false);
  assert.equal(out.contextOverflow, true);
});

test("claude sdk runner returns timed out result", async () => {
  const runner = mod.createClaudeSdkRunner({
    clientFactory: async () => ({
      messages: {
        create: async () => new Promise(() => {}),
      },
    }),
  });

  const out = await runner.run({
    role: "task",
    phaseName: "execution",
    prompt: "Task",
    cwd: process.cwd(),
    timeoutMs: 10,
    exec: { run: async () => ({ exitCode: 0, stdout: "", stderr: "", timedOut: false }) },
  });

  assert.equal(out.success, false);
  assert.equal(out.timedOut, true);
  assert.match(out.error ?? "", /timed out/i);
});
