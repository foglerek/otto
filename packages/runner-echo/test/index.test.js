import assert from "node:assert/strict";
import { test } from "node:test";

import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { interopDefault: true });
const mod = await jiti(new URL("../src/index.ts", import.meta.url).href);

test("echo runner returns prompt with <OK>", async () => {
  const runner = mod.createEchoRunner();

  const result = await runner.run({
    role: "task",
    phaseName: "execution",
    prompt: "Implement feature X",
    cwd: process.cwd(),
    exec: {
      async run() {
        throw new Error("echo runner should not call exec");
      },
    },
  });

  assert.equal(result.success, true);
  assert.equal(result.sessionId, "echo-session");
  assert.match(result.outputText, /Implement feature X/);
  assert.match(result.outputText, /<OK>/);
});

test("echo runner preserves provided session id", async () => {
  const runner = mod.createEchoRunner();
  const result = await runner.run({
    role: "projectLead",
    phaseName: "ticket-create",
    prompt: "Write a ticket",
    cwd: process.cwd(),
    exec: {
      async run() {
        throw new Error("echo runner should not call exec");
      },
    },
    sessionId: "existing-session",
  });

  assert.equal(result.success, true);
  assert.equal(result.sessionId, "existing-session");
});
