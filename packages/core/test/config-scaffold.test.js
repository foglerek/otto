import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";

import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { interopDefault: true });
const scaffold = await jiti(new URL("../src/config-scaffold.ts", import.meta.url).href);

test("ensureDefaultConfigFile creates default config only once", async () => {
  const repo = await fs.mkdtemp(path.join(os.tmpdir(), "otto-config-"));
  const configPath = path.join(repo, "otto.config.ts");

  const created = await scaffold.ensureDefaultConfigFile(configPath);
  assert.equal(created, true);

  const content = await fs.readFile(configPath, "utf8");
  assert.match(content, /defineOttoConfig/);
  assert.match(content, /createGitWorktreeAdapter/);
  assert.match(content, /createEchoRunner/);

  const second = await scaffold.ensureDefaultConfigFile(configPath);
  assert.equal(second, false);
});
