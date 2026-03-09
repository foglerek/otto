import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { expect, test } from "bun:test";

import { loadRuns } from "../src/index.js";

test("loadRuns reads states, maps ticket slug, and sorts newest first", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "otto-ui-runs-"));
  const statesDir = path.join(root, ".otto", "states");
  await fs.mkdir(statesDir, { recursive: true });

  await fs.writeFile(
    path.join(statesDir, "run-a.json"),
    JSON.stringify({
      runId: "run-a",
      createdAt: "2026-01-01T00:00:00.000Z",
      ticket: { slug: "alpha-ticket" },
      worktree: { branchName: "otto-run-a" },
    }),
    "utf8",
  );

  await fs.writeFile(
    path.join(statesDir, "run-b.json"),
    JSON.stringify({
      runId: "run-b",
      createdAt: "2026-02-01T00:00:00.000Z",
      ask: { slug: "legacy-ask-slug" },
      worktree: { branchName: "otto-run-b" },
    }),
    "utf8",
  );

  await fs.writeFile(path.join(statesDir, "broken.json"), "{", "utf8");

  const runs = await loadRuns(statesDir);
  expect(runs.length).toBe(2);
  expect(runs.map((r) => r.runId)).toEqual(["run-b", "run-a"]);
  expect(runs[0].ticketSlug).toBe("legacy-ask-slug");
  expect(runs[1].ticketSlug).toBe("alpha-ticket");
});
