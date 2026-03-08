import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";

import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { interopDefault: true });
const cli = await jiti(new URL("../src/index.ts", import.meta.url).href);

test("parseOttoArgs handles root and help", () => {
  assert.deepEqual(cli.parseOttoArgs([]), {
    command: "root",
    args: [],
    helpRequested: false,
  });

  const help = cli.parseOttoArgs(["--help"]);
  assert.equal(help.command, "help");
  assert.equal(help.helpRequested, true);
});

test("parseOttoArgs returns command args", () => {
  const parsed = cli.parseOttoArgs(["create", "Add", "caching"]);
  assert.equal(parsed.command, "create");
  assert.deepEqual(parsed.args, ["Add", "caching"]);
});

test("resolveCommandHandler routes known commands", () => {
  assert.equal(typeof cli.resolveCommandHandler("create"), "function");
  assert.equal(cli.resolveCommandHandler("unknown"), null);
});

test("create fails with no usable runner message by default", async () => {
  const repo = await fs.mkdtemp(path.join(process.cwd(), ".tmp-otto-cli-"));
  const prevCwd = process.cwd();
  const prevExitCode = process.exitCode;
  const stderrChunks = [];
  const stderrWrite = process.stderr.write;

  process.chdir(repo);
  process.exitCode = 0;
  process.stderr.write = ((chunk) => {
    stderrChunks.push(String(chunk));
    return true;
  });

  try {
    await cli.runOttoCLI(["create", "Build", "a", "new", "feature"]);
  } finally {
    process.stderr.write = stderrWrite;
    process.chdir(prevCwd);
    process.exitCode = prevExitCode;
    await fs.rm(repo, { recursive: true, force: true });
  }

  const stderr = stderrChunks.join("");
  assert.match(stderr, /Error, need to configure at least one runner\. See README/);
});
