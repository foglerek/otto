import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const WORKFLOW_SRC = fileURLToPath(new URL("../src/workflow", import.meta.url));

async function listTsFiles(root) {
  const out = [];
  const entries = await fs.readdir(root, { withFileTypes: true });
  for (const entry of entries) {
    const full = path.join(root, entry.name);
    if (entry.isDirectory()) {
      out.push(...(await listTsFiles(full)));
      continue;
    }
    if (entry.isFile() && entry.name.endsWith(".ts")) {
      out.push(full);
    }
  }
  return out;
}

test("workflow state persistence goes through reducer dispatch", async () => {
  const files = await listTsFiles(WORKFLOW_SRC);
  const violations = [];

  for (const file of files) {
    if (file.endsWith("state-reducer.ts")) continue;
    const text = await fs.readFile(file, "utf8");
    if (text.includes("stateStore.save(")) {
      violations.push(`${path.relative(WORKFLOW_SRC, file)} uses stateStore.save()`);
    }
    if (text.includes("stateStore.update(")) {
      violations.push(`${path.relative(WORKFLOW_SRC, file)} uses stateStore.update()`);
    }
  }

  assert.deepEqual(violations, []);
});
