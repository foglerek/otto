import assert from "node:assert/strict";
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
