import assert from "node:assert/strict";
import { test } from "node:test";

import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { interopDefault: true });
const mod = await jiti(new URL("../src/index.ts", import.meta.url).href);

test("google genai runner parses direct text response", async () => {
  let request;
  const runner = mod.createGoogleGenAiRunner({
    byRole: {
      task: { model: "gemini-2.5-pro" },
    },
    clientFactory: async () => ({
      models: {
        generateContent: async (input) => {
          request = input;
          return {
            responseId: "gen_1",
            text: "done",
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
  assert.equal(out.sessionId, "gen_1");
  assert.equal(out.outputText, "done");
  assert.equal(request.model, "gemini-2.5-pro");
  assert.equal(request.contents, "Do work");
});

test("google genai runner parses candidates parts", async () => {
  const runner = mod.createGoogleGenAiRunner({
    clientFactory: async () => ({
      models: {
        generateContent: async () => ({
          id: "gen_2",
          candidates: [
            {
              content: {
                parts: [{ text: "hello" }, { text: "world" }],
              },
            },
          ],
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
  assert.equal(out.sessionId, "gen_2");
  assert.equal(out.outputText, "hello\nworld");
});

test("google genai runner forwards json schema", async () => {
  let request;
  const runner = mod.createGoogleGenAiRunner({
    clientFactory: async () => ({
      models: {
        generateContent: async (input) => {
          request = input;
          return { responseId: "gen_json", text: "{}" };
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
    role: "task",
    phaseName: "execution",
    prompt: "Emit JSON",
    cwd: process.cwd(),
    jsonSchema: schema,
    exec: { run: async () => ({ exitCode: 0, stdout: "", stderr: "", timedOut: false }) },
  });

  assert.equal(out.success, true);
  assert.equal(request.config.responseMimeType, "application/json");
  assert.deepEqual(request.config.responseSchema, schema);
});

test("google genai runner flags context overflow on error", async () => {
  const runner = mod.createGoogleGenAiRunner({
    clientFactory: async () => ({
      models: {
        generateContent: async () => {
          throw new Error("token limit exceeded");
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

test("google genai runner returns timed out result", async () => {
  const runner = mod.createGoogleGenAiRunner({
    clientFactory: async () => ({
      models: {
        generateContent: async () => new Promise(() => {}),
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

test("google genai runner reports unavailable sdk from factory", async () => {
  const runner = mod.createGoogleGenAiRunner({
    clientFactory: async () => {
      throw new Error("Cannot find package '@google/genai'");
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
  assert.match(out.error ?? "", /genai/i);
});
