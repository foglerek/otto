import assert from "node:assert/strict";
import { test } from "node:test";

import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { interopDefault: true });
const mod = await jiti(new URL("../src/index.ts", import.meta.url).href);

test("quality adapter runs checks and reports aggregate pass", async () => {
  const adapter = mod.createCommandQualityGateAdapter();
  const calls = [];

  const exec = {
    async run(cmd, options) {
      calls.push({ cmd, options });
      return {
        exitCode: 0,
        stdout: `ran ${cmd.join(" ")}`,
        stderr: "",
        timedOut: false,
      };
    },
  };

  const result = await adapter.runChecks({
    worktreePath: "/tmp/repo",
    exec,
    checks: [
      { name: "lint", cmd: ["bun", "run", "lint"] },
      { name: "test", cmd: ["bun", "run", "test"] },
    ],
  });

  assert.equal(result.ok, true);
  assert.equal(result.results.length, 2);
  assert.equal(result.results[0].name, "lint");
  assert.equal(result.results[0].ok, true);
  assert.equal(calls.length, 2);
  assert.equal(calls[0].options.cwd, "/tmp/repo");
});

test("quality adapter marks failed and timed out checks as not ok", async () => {
  const adapter = mod.createCommandQualityGateAdapter();

  const exec = {
    async run(cmd) {
      if (cmd[0] === "lint") {
        return {
          exitCode: 1,
          stdout: "",
          stderr: "lint failed",
          timedOut: false,
        };
      }
      return {
        exitCode: 0,
        stdout: "",
        stderr: "",
        timedOut: true,
      };
    },
  };

  const result = await adapter.runChecks({
    worktreePath: "/tmp/repo",
    exec,
    checks: [
      { name: "lint", cmd: ["lint"] },
      { name: "integration", cmd: ["integration"] },
    ],
  });

  assert.equal(result.ok, false);
  assert.equal(result.results[0].ok, false);
  assert.equal(result.results[1].ok, false);
  assert.equal(result.results[0].stderr, "lint failed");
});
