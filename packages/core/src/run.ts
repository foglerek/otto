import fs from "node:fs/promises";
import path from "node:path";

import type { OttoConfig } from "@otto/config";

import type { OttoStateV1 } from "./state.js";

async function ensureDir(dirPath: string): Promise<void> {
  await fs.mkdir(dirPath, { recursive: true });
}

export async function runOttoRun(args: {
  state: OttoStateV1;
  config: OttoConfig;
}): Promise<{ planFilePath: string }> {
  const runDir = path.join(
    args.state.artifactRootDir,
    "runs",
    args.state.runId,
  );
  await ensureDir(runDir);

  const planFilePath = path.join(runDir, "plan.json");

  const plan = {
    version: 1,
    runId: args.state.runId,
    createdAt: new Date().toISOString(),
    ask: args.state.ask,
    worktree: args.state.worktree,
    steps: [],
    notes: "Scaffold plan file. The real planner is not implemented yet.",
  };

  await fs.writeFile(
    planFilePath,
    JSON.stringify(plan, null, 2) + "\n",
    "utf8",
  );
  return { planFilePath };
}
