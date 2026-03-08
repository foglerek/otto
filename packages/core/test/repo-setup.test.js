import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";

import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { interopDefault: true });
const setupMod = await jiti(new URL("../src/repo-setup.ts", import.meta.url).href);

function makeConfig() {
  const noopRunner = {
    id: "test-runner",
    kind: "shell",
    run: async () => ({
      success: true,
      outputText: "ok",
      sessionId: null,
      timedOut: false,
      contextOverflow: false,
    }),
  };

  return {
    worktree: {
      baseBranch: "main",
      worktreesDir: ".worktrees",
      branchNamer: ({ ticket }) => `otto-${ticket.date}-${ticket.slug}`,
      adapter: {
        getMainRepoPath: async (cwd) => cwd,
        createWorktree: async () => ({ worktreePath: "/tmp/wt" }),
        removeWorktree: async () => {},
      },
      afterCreate: async () => {},
    },
    runners: {
      default: noopRunner,
    },
  };
}

test("ensureRepoSetup creates onboarding state and gitignore entries", async () => {
  const repo = await fs.mkdtemp(path.join(os.tmpdir(), "otto-setup-"));
  const config = makeConfig();

  const result = await setupMod.ensureRepoSetup({
    mainRepoPath: repo,
    config,
  });

  const onboardingPath = path.join(result.artifactPaths.statesDir, "onboarding.json");
  const onboardingRaw = await fs.readFile(onboardingPath, "utf8");
  const onboarding = JSON.parse(onboardingRaw);

  assert.equal(onboarding.kind, "otto.onboarding");
  assert.equal(onboarding.version, 1);
  assert.equal(onboarding.status, "initialized");
  assert.equal(path.resolve(onboarding.mainRepoPath), path.resolve(repo));

  const gitignore = await fs.readFile(path.join(repo, ".gitignore"), "utf8");
  assert.match(gitignore, /\.otto\//);
  assert.match(gitignore, /\.worktrees\//);
});

test("ensureRepoSetup does not rewrite existing onboarding state", async () => {
  const repo = await fs.mkdtemp(path.join(os.tmpdir(), "otto-setup-idem-"));
  const config = makeConfig();

  const first = await setupMod.ensureRepoSetup({ mainRepoPath: repo, config });
  const onboardingPath = path.join(first.artifactPaths.statesDir, "onboarding.json");
  const initial = await fs.readFile(onboardingPath, "utf8");

  await setupMod.ensureRepoSetup({ mainRepoPath: repo, config });
  const after = await fs.readFile(onboardingPath, "utf8");

  assert.equal(after, initial);
});
