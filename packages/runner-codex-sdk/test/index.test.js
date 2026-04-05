import assert from "node:assert/strict";
import { test } from "node:test";

import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { interopDefault: true });
const mod = await jiti(new URL("../src/index.ts", import.meta.url).href);

function makeResponseStream(events) {
  return {
    async *[Symbol.asyncIterator]() {
      for (const event of events) {
        yield event;
      }
    },
    controller: {
      abort() {},
    },
  };
}

test("codex sdk runner parses output_text response", async () => {
  let request;
  const runner = mod.createCodexSdkRunner({
    byRole: {
      task: { model: "gpt-5-codex" },
    },
    clientFactory: async () => ({
      responses: {
        create: async (input) => {
          request = input;
          return {
            id: "resp_1",
            output_text: "done",
          };
        },
      },
    }),
  });

  const out = await runner.run({
    role: "task",
    phaseName: "execution",
    prompt: "Do work",
    cwd: process.cwd(),
    exec: { run: async () => ({ exitCode: 0, stdout: "", stderr: "", timedOut: false }) },
  });

  assert.equal(out.success, true);
  assert.equal(out.sessionId, "resp_1");
  assert.equal(out.outputText, "done");
  assert.equal(request.model, "gpt-5-codex");
  assert.equal(request.input, "Do work");
});

test("codex sdk runner forwards json schema", async () => {
  let request;
  const runner = mod.createCodexSdkRunner({
    clientFactory: async () => ({
      responses: {
        create: async (input) => {
          request = input;
          return { id: "resp_json", output_text: "{}" };
        },
      },
    }),
  });

  const schema = {
    type: "object",
    properties: {
      ok: { type: "boolean" },
    },
    required: ["ok"],
    additionalProperties: false,
  };

  const out = await runner.run({
    role: "summarize",
    phaseName: "summarize",
    prompt: "Emit JSON",
    cwd: process.cwd(),
    jsonSchema: schema,
    exec: { run: async () => ({ exitCode: 0, stdout: "", stderr: "", timedOut: false }) },
  });

  assert.equal(out.success, true);
  assert.equal(request.text.format.type, "json_schema");
  assert.equal(request.text.format.name, "otto_output");
  assert.deepEqual(request.text.format.schema, schema);
});

test("codex sdk runner reports unavailable sdk from factory", async () => {
  const runner = mod.createCodexSdkRunner({
    clientFactory: async () => {
      throw new Error("Cannot find package 'openai'");
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
  assert.match(out.error ?? "", /openai/i);
});

test("codex sdk runner flags context overflow on error", async () => {
  const runner = mod.createCodexSdkRunner({
    clientFactory: async () => ({
      responses: {
        create: async () => {
          throw new Error("maximum context length exceeded");
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

test("codex sdk runner returns timed out result", async () => {
  const runner = mod.createCodexSdkRunner({
    clientFactory: async () => ({
      responses: {
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

test("codex sdk runner emits AG-UI assistant events", async () => {
  const events = [];
  const runner = mod.createCodexSdkRunner({
    clientFactory: async () => ({
      responses: {
        create: async () => ({ id: "resp_live", output_text: "codex sdk hello" }),
      },
    }),
  });

  await runner.run({
    role: "task",
    phaseName: "execution",
    prompt: "Do work",
    cwd: process.cwd(),
    exec: { run: async () => ({ exitCode: 0, stdout: "", stderr: "", timedOut: false }) },
    onEvent: async (event) => {
      events.push(event);
    },
  });

  assert.deepEqual(events.map((event) => event.type), [
    "TEXT_MESSAGE_START",
    "TEXT_MESSAGE_CONTENT",
    "TEXT_MESSAGE_END",
  ]);
  assert.equal(events[1].delta, "codex sdk hello");
});

test("codex sdk runner prefers streaming responses when available", async () => {
  const events = [];
  const logs = [];
  const runner = mod.createCodexSdkRunner({
    clientFactory: async () => ({
      responses: {
        create: async (input) => {
          if (input.stream === true) {
            return makeResponseStream([
              { type: "response.output_text.delta", delta: "hello " },
              { type: "response.output_text.delta", delta: "codex" },
              { type: "response.completed" },
            ]);
          }
          throw new Error("unexpected non-streaming fallback");
        },
      },
    }),
  });

  const out = await runner.run({
    role: "task",
    phaseName: "execution",
    prompt: "Do work",
    cwd: process.cwd(),
    exec: { run: async () => ({ exitCode: 0, stdout: "", stderr: "", timedOut: false }) },
    onEvent: async (event) => {
      events.push(event);
    },
    onLog: async (entry) => {
      logs.push(entry);
    },
  });

  assert.equal(out.success, true);
  assert.equal(out.outputText, "hello codex");
  assert.deepEqual(events.map((event) => event.type), [
    "TEXT_MESSAGE_START",
    "TEXT_MESSAGE_CONTENT",
    "TEXT_MESSAGE_CONTENT",
    "TEXT_MESSAGE_END",
  ]);
  assert.equal(events[1].delta, "hello ");
  assert.equal(events[2].delta, "codex");
  assert.equal(logs[0].channel, "raw");
});
