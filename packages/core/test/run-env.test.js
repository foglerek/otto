import assert from "node:assert/strict";
import { test } from "node:test";

import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { interopDefault: true });
const run = await jiti(new URL("../src/run.ts", import.meta.url).href);

test("buildRunDefaultEnv merges env and testEnv with testEnv precedence", () => {
  const state = {
    env: {
      ANTHROPIC_API_KEY: "",
      KEEP: "from-env",
      SHARED: "env",
    },
    testEnv: {
      DATABASE_URL: "postgres://local/test",
      SHARED: "test",
    },
  };

  const merged = run.buildRunDefaultEnv(state);

  assert.deepEqual(merged, {
    ANTHROPIC_API_KEY: "",
    KEEP: "from-env",
    SHARED: "test",
    DATABASE_URL: "postgres://local/test",
  });
});

test("buildRunDefaultEnv handles missing env maps", () => {
  assert.deepEqual(run.buildRunDefaultEnv({}), {});
  assert.deepEqual(run.buildRunDefaultEnv({ env: { A: "1" } }), { A: "1" });
});
