import assert from "node:assert/strict";
import { test } from "node:test";

import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { interopDefault: true });
const controlPlaneModule = await jiti(new URL("../src/web/control-plane.ts", import.meta.url).href);

test("web control plane bridges prompt requests through the server", async () => {
  const controlPlane = controlPlaneModule.createOttoWebControlPlane();

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
  assert.equal(snapshot.pendingPrompt?.kind, "confirm");
  controlPlane.respondToPrompt({
    promptId: snapshot.pendingPrompt.id,
    value: true,
  });

  await new Promise((resolve) => setTimeout(resolve, 0));
  snapshot = controlPlane.getSnapshot();
  assert.equal(snapshot.pendingPrompt?.kind, "text");
  controlPlane.respondToPrompt({
    promptId: snapshot.pendingPrompt.id,
    value: "ship it",
  });

  await new Promise((resolve) => setTimeout(resolve, 0));
  snapshot = controlPlane.getSnapshot();
  assert.equal(snapshot.pendingPrompt, null);
  assert.equal(snapshot.jobs[0].status, "succeeded");
  assert.deepEqual(snapshot.jobs[0].result, { approved: true, note: "ship it" });
});
