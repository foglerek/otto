import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";

import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { interopDefault: true });
const promptState = await jiti(new URL("../src/prompt-state.ts", import.meta.url).href);
const stateModule = await jiti(new URL("../src/state.ts", import.meta.url).href);

test("tracked prompt adapter toggles needsUserInput in state", async () => {
  const repo = await fs.mkdtemp(path.join(process.cwd(), ".tmp-prompt-state-"));
  const stateFilePath = path.join(repo, "run-state.json");

  const state = {
    kind: "otto.state",
    version: 1,
    runId: "2026-04-04-prompt-state",
    createdAt: new Date().toISOString(),
    mainRepoPath: repo,
    artifactRootDir: path.join(repo, ".otto"),
    stateFilePath,
    runDir: path.join(repo, ".otto", "runs", "2026-04-04-prompt-state"),
    lockFilePath: path.join(repo, ".otto", "locks", "run-2026-04-04-prompt-state.json"),
    workflow: {
      phase: "execution",
      needsUserInput: false,
      taskQueue: [],
      taskAgentSessions: {},
      reviewerSessions: {},
      autoRetryCounts: {},
    },
    ticket: {
      date: "2026-04-04",
      slug: "prompt-state",
      filePath: path.join(repo, ".otto", "tickets", "2026-04-04-prompt-state.md"),
    },
    worktree: {
      worktreePath: path.join(repo, ".worktrees", "2026-04-04-prompt-state"),
      branchName: "otto-2026-04-04-prompt-state",
      baseBranch: "main",
    },
  };
  await fs.mkdir(path.dirname(stateFilePath), { recursive: true });
  await fs.writeFile(stateFilePath, JSON.stringify(state, null, 2), "utf8");

  let releasePrompt = () => {};
  const wrapped = promptState.createTrackedPromptAdapter({
    stateFilePath,
    prompt: {
      confirm: async () =>
        await new Promise((resolve) => {
          releasePrompt = () => resolve(true);
        }),
      text: async () => "",
      select: async () => "",
    },
  });

  const pending = wrapped.confirm("Continue?");
  let waitingState = await stateModule.loadOttoState(stateFilePath);
  for (let attempt = 0; attempt < 20 && waitingState.workflow.needsUserInput !== true; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 5));
    waitingState = await stateModule.loadOttoState(stateFilePath);
  }
  assert.equal(waitingState.workflow.needsUserInput, true);

  releasePrompt();
  assert.equal(await pending, true);

  const settledState = await stateModule.loadOttoState(stateFilePath);
  assert.equal(settledState.workflow.needsUserInput, false);

  await fs.rm(repo, { recursive: true, force: true });
});
