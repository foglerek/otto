import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";

import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { interopDefault: true });
const controlPlaneModule = await jiti(new URL("../src/web/control-plane.ts", import.meta.url).href);

test("web control plane bridges prompt requests through the server", async () => {
  const controlPlane = await controlPlaneModule.createOttoWebControlPlane();

  const job = await controlPlane.startJob({
    kind: "resume",
    runId: "2026-04-04-bridge-test",
    run: async (jobSnapshot) => {
      const prompt = controlPlane.createPromptAdapter({
        jobId: jobSnapshot.id,
        runId: jobSnapshot.runId,
      });
      const approved = await prompt.confirm("Proceed?", { defaultValue: true });
      const note = await prompt.text("Why?", { defaultValue: "because" });
      return { approved, note };
    },
  });

  assert.equal(controlPlane.getSnapshot().jobs[0].status, "waiting");

  let snapshot = controlPlane.getSnapshot();
  assert.equal(snapshot.prompts[0]?.kind, "confirm");
  await controlPlane.respondToPrompt({
    promptId: snapshot.prompts[0].id,
    value: true,
  });

  await new Promise((resolve) => setTimeout(resolve, 0));
  snapshot = controlPlane.getSnapshot();
  assert.equal(snapshot.prompts[0]?.kind, "text");
  await controlPlane.respondToPrompt({
    promptId: snapshot.prompts[0].id,
    value: "ship it",
  });

  await new Promise((resolve) => setTimeout(resolve, 0));
  snapshot = controlPlane.getSnapshot();
  assert.deepEqual(snapshot.prompts, []);
  assert.equal(snapshot.jobs[0].status, "succeeded");
  assert.deepEqual(snapshot.jobs[0].result, { approved: true, note: "ship it" });
});

test("web control plane supports concurrent jobs across different runs", async () => {
  const controlPlane = await controlPlaneModule.createOttoWebControlPlane();

  await Promise.all([
    controlPlane.startJob({
      kind: "start",
      runId: "2026-04-04-alpha",
      run: async (jobSnapshot) => {
        const prompt = controlPlane.createPromptAdapter({
          jobId: jobSnapshot.id,
          runId: jobSnapshot.runId,
        });
        return await prompt.confirm("alpha?", { defaultValue: true });
      },
    }),
    controlPlane.startJob({
      kind: "resume",
      runId: "2026-04-04-beta",
      run: async (jobSnapshot) => {
        const prompt = controlPlane.createPromptAdapter({
          jobId: jobSnapshot.id,
          runId: jobSnapshot.runId,
        });
        return await prompt.confirm("beta?", { defaultValue: false });
      },
    }),
  ]);

  let snapshot = controlPlane.getSnapshot();
  assert.equal(snapshot.prompts.length, 2);
  assert.deepEqual(snapshot.prompts.map((prompt) => prompt.runId).sort(), [
    "2026-04-04-alpha",
    "2026-04-04-beta",
  ]);

  await controlPlane.respondToPrompt({
    promptId: snapshot.prompts.find((prompt) => prompt.runId === "2026-04-04-alpha").id,
    value: true,
  });
  await controlPlane.respondToPrompt({
    promptId: snapshot.prompts.find((prompt) => prompt.runId === "2026-04-04-beta").id,
    value: false,
  });

  await new Promise((resolve) => setTimeout(resolve, 0));
  snapshot = controlPlane.getSnapshot();
  assert.deepEqual(snapshot.prompts, []);
  assert.equal(snapshot.jobs.filter((job) => job.status === "succeeded").length, 2);
});

test("web control plane persists jobs and fails interrupted sessions on restart", async () => {
  const tempDir = await fs.mkdtemp(path.join(process.cwd(), ".tmp-web-control-"));
  const filePath = path.join(tempDir, "web-control-plane.json");
  const first = await controlPlaneModule.createOttoWebControlPlane({ persistenceFilePath: filePath });

  await first.startJob({
    kind: "start",
    runId: "2026-04-04-restart-test",
    run: async (jobSnapshot) => {
      const prompt = first.createPromptAdapter({
        jobId: jobSnapshot.id,
        runId: jobSnapshot.runId,
      });
      await prompt.confirm("Still there?", { defaultValue: true });
      return { ok: true };
    },
  });

  await new Promise((resolve) => setTimeout(resolve, 0));
  const second = await controlPlaneModule.createOttoWebControlPlane({ persistenceFilePath: filePath });
  const snapshot = second.getSnapshot();
  assert.deepEqual(snapshot.prompts, []);
  assert.equal(snapshot.jobs[0].status, "failed");
  assert.match(snapshot.jobs[0].error, /server restarted/i);

  await fs.rm(tempDir, { recursive: true, force: true });
});
