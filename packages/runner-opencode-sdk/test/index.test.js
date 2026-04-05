import assert from "node:assert/strict";
import { test } from "node:test";

import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { interopDefault: true });
const mod = await jiti(new URL("../src/index.ts", import.meta.url).href);

function makeEventStream(events) {
  return {
    async *[Symbol.asyncIterator]() {
      for (const event of events) {
        yield event;
      }
    },
  };
}

test("opencode sdk runner parses run client response", async () => {
  let request;
  const runner = mod.createOpencodeSdkRunner({
    byRole: {
      task: { model: "openai/gpt-5.3-codex", variant: "high" },
    },
    clientFactory: async () => ({
      run: async (input) => {
        request = input;
        return {
          session_id: "op_sdk_1",
          result: "done",
        };
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
  assert.equal(out.sessionId, "op_sdk_1");
  assert.equal(out.outputText, "done");
  assert.equal(request.model, "openai/gpt-5.3-codex");
  assert.equal(request.variant, "high");
  assert.equal(request.prompt, "Do work");
});

test("opencode sdk runner supports responses.create clients", async () => {
  const runner = mod.createOpencodeSdkRunner({
    clientFactory: async () => ({
      responses: {
        create: async () => ({
          sessionId: "op_sdk_2",
          output_text: "response path",
        }),
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
  assert.equal(out.sessionId, "op_sdk_2");
  assert.equal(out.outputText, "response path");
});

test("opencode sdk runner forwards json schema and session", async () => {
  let request;
  const runner = mod.createOpencodeSdkRunner({
    clientFactory: async () => ({
      run: async (input) => {
        request = input;
        return { session_id: "schema_1", result: "{}" };
      },
    }),
  });

  const schema = {
    type: "object",
    properties: { ok: { type: "boolean" } },
    required: ["ok"],
    additionalProperties: false,
  };

  const out = await runner.run({
    role: "lead",
    phaseName: "plan",
    prompt: "Emit JSON",
    cwd: process.cwd(),
    sessionId: "prev-session",
    jsonSchema: schema,
    exec: { run: async () => ({ exitCode: 0, stdout: "", stderr: "", timedOut: false }) },
  });

  assert.equal(out.success, true);
  assert.equal(request.sessionId, "prev-session");
  assert.deepEqual(request.jsonSchema, schema);
});

test("opencode sdk runner flags overflow on error", async () => {
  const runner = mod.createOpencodeSdkRunner({
    clientFactory: async () => ({
      run: async () => ({
        is_error: true,
        result: "prompt too long",
      }),
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

test("opencode sdk runner reports unavailable sdk from factory", async () => {
  const runner = mod.createOpencodeSdkRunner({
    clientFactory: async () => {
      throw new Error("Cannot find package 'opencode-sdk'");
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
  assert.match(out.error ?? "", /opencode/i);
});

test("opencode sdk runner returns timed out result", async () => {
  const runner = mod.createOpencodeSdkRunner({
    clientFactory: async () => ({
      run: async () => new Promise(() => {}),
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

test("opencode sdk runner emits AG-UI assistant events", async () => {
  const events = [];
  const runner = mod.createOpencodeSdkRunner({
    clientFactory: async () => ({
      run: async () => ({ session_id: "op_live", result: "opencode sdk hello" }),
    }),
  });

  await runner.run({
    role: "task",
    phaseName: "execution",
    prompt: "Do task",
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
  assert.equal(events[1].delta, "opencode sdk hello");
});

test("opencode sdk runner supports session/event streaming clients", async () => {
  const events = [];
  const runner = mod.createOpencodeSdkRunner({
    clientFactory: async () => ({
      session: {
        create: async () => ({ id: "session_stream_1" }),
        prompt: async () => ({
          info: { sessionID: "session_stream_1" },
          parts: [{ type: "text", text: "stream hello" }],
        }),
      },
      event: {
        subscribe: async () => ({
          stream: makeEventStream([
            {
              payload: {
                type: "message.part.updated",
                properties: {
                  part: {
                    id: "tool_part_1",
                    sessionID: "session_stream_1",
                    messageID: "msg_1",
                    type: "tool",
                    callID: "call_1",
                    tool: "bash",
                    state: {
                      status: "completed",
                      input: { command: "pwd" },
                      output: "/tmp/worktree",
                    },
                  },
                },
              },
            },
            {
              payload: {
                type: "message.part.updated",
                properties: {
                  part: {
                    id: "text_part_1",
                    sessionID: "session_stream_1",
                    messageID: "msg_1",
                    type: "text",
                    text: "stream hello",
                    time: { start: 1, end: 2 },
                  },
                  delta: "stream hello",
                },
              },
            },
          ]),
        }),
      },
    }),
  });

  const out = await runner.run({
    role: "task",
    phaseName: "execution",
    prompt: "Do task",
    cwd: process.cwd(),
    exec: { run: async () => ({ exitCode: 0, stdout: "", stderr: "", timedOut: false }) },
    onEvent: async (event) => {
      events.push(event);
    },
  });

  assert.equal(out.success, true);
  assert.equal(out.sessionId, "session_stream_1");
  assert.equal(out.outputText, "stream hello");
  assert.deepEqual(events.map((event) => event.type), [
    "TOOL_CALL_START",
    "TOOL_CALL_ARGS",
    "TOOL_CALL_END",
    "TOOL_CALL_RESULT",
    "TEXT_MESSAGE_START",
    "TEXT_MESSAGE_CONTENT",
    "TEXT_MESSAGE_END",
  ]);
  assert.equal(events[0].toolCallName, "bash");
  assert.equal(events[3].content, "/tmp/worktree");
  assert.equal(events[5].delta, "stream hello");
});
