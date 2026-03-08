import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";

import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { interopDefault: true });
const stateMod = await jiti(new URL("../src/state.ts", import.meta.url).href);
const artifacts = await jiti(new URL("../src/artifacts.ts", import.meta.url).href);

function makeValidState(repoPath) {
  const artifactRootDir = path.join(repoPath, ".otto");
  const runId = "2026-02-03-state-test";
  return {
    kind: "otto.state",
    version: 1,
    runId,
    createdAt: new Date().toISOString(),
    mainRepoPath: repoPath,
    artifactRootDir,
    stateFilePath: path.join(artifactRootDir, "states", `run-${runId}.json`),
    runDir: path.join(artifactRootDir, "runs", runId),
    lockFilePath: path.join(artifactRootDir, "locks", `run-${runId}.json`),
    ticket: {
      date: "2026-02-03",
      slug: "state-test",
      filePath: path.join(artifactRootDir, "tickets", `${runId}.md`),
    },
    worktree: {
      worktreePath: path.join(repoPath, ".worktrees", runId),
      branchName: `otto-${runId}`,
      baseBranch: "main",
    },
  };
}

test("loadOttoState validates and loads a valid state file", async () => {
  const repo = await fs.mkdtemp(path.join(os.tmpdir(), "otto-state-"));
  const state = makeValidState(repo);
  await fs.mkdir(path.dirname(state.stateFilePath), { recursive: true });
  await fs.writeFile(state.stateFilePath, JSON.stringify(state, null, 2), "utf8");

  const loaded = await stateMod.loadOttoState(state.stateFilePath);
  assert.equal(loaded.kind, "otto.state");
  assert.equal(loaded.runId, state.runId);
  assert.equal(loaded.ticket.slug, "state-test");
});

test("loadOttoState rejects invalid state kind", async () => {
  const repo = await fs.mkdtemp(path.join(os.tmpdir(), "otto-state-kind-"));
  const state = makeValidState(repo);
  state.kind = "invalid.kind";
  await fs.mkdir(path.dirname(state.stateFilePath), { recursive: true });
  await fs.writeFile(state.stateFilePath, JSON.stringify(state, null, 2), "utf8");

  await assert.rejects(
    () => stateMod.loadOttoState(state.stateFilePath),
    /Invalid state kind/,
  );
});

test("resolveConfigPathFromState honors override then state then default", () => {
  const state = makeValidState("/tmp/repo");
  state.configPath = "/tmp/repo/custom/otto.config.ts";

  const withOverride = stateMod.resolveConfigPathFromState({
    state,
    overridePath: "/tmp/override/otto.config.ts",
  });
  assert.equal(withOverride, path.resolve("/tmp/override/otto.config.ts"));

  const withState = stateMod.resolveConfigPathFromState({ state });
  assert.equal(withState, path.resolve(state.configPath));

  delete state.configPath;
  const fallback = stateMod.resolveConfigPathFromState({ state });
  assert.equal(fallback, path.join(state.mainRepoPath, "otto.config.ts"));
});

test("ensureArtifactDirs creates all expected directories", async () => {
  const repo = await fs.mkdtemp(path.join(os.tmpdir(), "otto-artifacts-"));
  const paths = artifacts.resolveArtifactPaths({ mainRepoPath: repo });

  await artifacts.ensureArtifactDirs(paths);

  const expected = [
    paths.rootDir,
    paths.ticketsDir,
    paths.runsDir,
    paths.logsDir,
    paths.statesDir,
    paths.locksDir,
    paths.sessionsDir,
  ];

  for (const dir of expected) {
    const stat = await fs.stat(dir);
    assert.equal(stat.isDirectory(), true);
  }
});

test("ensureGitignoreHasDir appends once and is idempotent", async () => {
  const repo = await fs.mkdtemp(path.join(os.tmpdir(), "otto-gitignore-"));
  const targetDir = path.join(repo, ".worktrees");

  await artifacts.ensureGitignoreHasDir({ mainRepoPath: repo, dirPath: targetDir });
  await artifacts.ensureGitignoreHasDir({ mainRepoPath: repo, dirPath: targetDir });

  const content = await fs.readFile(path.join(repo, ".gitignore"), "utf8");
  const lines = content.split(/\r?\n/).filter(Boolean);
  const matches = lines.filter((line) => line.trim() === ".worktrees/");
  assert.equal(matches.length, 1);
});
