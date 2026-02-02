import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";

import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { interopDefault: true });
const lock = await jiti(new URL("../src/locks/run-lock.ts", import.meta.url).href);

const tempRepo = async () => fs.mkdtemp(path.join(os.tmpdir(), "otto-lock-"));

test("run lock writes and reads lock files", async () => {
  const root = await tempRepo();
  const lockFilePath = lock.getRunLockFilePath({
    artifactRootDir: root,
    runId: "2026-02-01-test",
  });
  const record = {
    pid: 4242,
    startedAt: new Date().toISOString(),
    runId: "2026-02-01-test",
    stateFilePath: path.join(root, "states", "run-2026-02-01-test.json"),
  };

  await lock.writeRunLockFile(lockFilePath, record);
  const loaded = await lock.readRunLockFile(lockFilePath);

  assert.deepEqual(loaded, record);
});

test("run lock stale detection uses injected pid liveness", async () => {
  const record = {
    pid: 9999,
    startedAt: "2026-02-01T00:00:00.000Z",
    runId: "2026-02-01-stale",
    stateFilePath: "/tmp/state.json",
  };

  await assert.doesNotReject(async () => {
    const stale = await lock.isRunLockStale({
      lock: record,
      isAlive: () => false,
    });
    assert.equal(stale, true);
  });

  await assert.doesNotReject(async () => {
    const stale = await lock.isRunLockStale({
      lock: record,
      isAlive: () => true,
    });
    assert.equal(stale, false);
  });
});

test("run lock kill safety helper detects otto process names", () => {
  assert.equal(lock.looksLikeOttoProcessName("otto"), true);
  assert.equal(lock.looksLikeOttoProcessName("OTTO"), true);
  assert.equal(lock.looksLikeOttoProcessName("node /path/to/otto.js"), true);
  assert.equal(lock.looksLikeOttoProcessName("node /path/to/other.js"), false);
});
