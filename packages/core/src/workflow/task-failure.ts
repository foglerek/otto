import fs from "node:fs/promises";
import path from "node:path";

import type { OttoStateV1 } from "../state.js";

function buildFailureTimestamp(): string {
  return new Date().toISOString().replace(/[:.]/g, "-");
}

export async function archiveFailedTaskArtifacts(args: {
  runDir: string;
  baseTaskName: string;
  timestamp?: string;
}): Promise<string> {
  const timestamp = args.timestamp ?? buildFailureTimestamp();
  const prefix = `failed-${timestamp}-`;
  const baseTaskFile = `${args.baseTaskName}.md`;
  const entries = await fs.readdir(args.runDir, { withFileTypes: true });

  await Promise.all(
    entries.map(async (entry) => {
      if (!entry.isFile()) return;
      const name = entry.name;
      if (!name.includes(args.baseTaskName)) return;
      if (name === baseTaskFile) return;
      if (name.startsWith("failed-")) return;

      const from = path.join(args.runDir, name);
      const to = path.join(args.runDir, `${prefix}${name}`);
      await fs.rename(from, to);
    }),
  );

  return timestamp;
}

export function clearTaskSessionsForBaseTask(
  state: OttoStateV1,
  baseTaskPath: string,
): boolean {
  const workflow = state.workflow;
  if (!workflow) return false;

  let changed = false;
  if (workflow.taskAgentSessions?.[baseTaskPath] !== undefined) {
    delete workflow.taskAgentSessions[baseTaskPath];
    changed = true;
  }
  if (workflow.reviewerSessions?.[baseTaskPath] !== undefined) {
    delete workflow.reviewerSessions[baseTaskPath];
    changed = true;
  }
  return changed;
}
