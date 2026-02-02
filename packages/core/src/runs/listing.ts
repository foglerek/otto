import fs from "node:fs/promises";
import path from "node:path";

import { loadOttoState, type OttoStateV1 } from "../state.js";
import {
  isRunLockStale,
  readRunLockFile,
  type RunLockFile,
} from "../locks/run-lock.js";

export type RunProcessStatus =
  | { status: "inactive" }
  | { status: "active"; lock: RunLockFile }
  | { status: "stale"; lock: RunLockFile };

export interface DiscoveredRun {
  state: OttoStateV1;
  stateFilePath: string;
  process: RunProcessStatus;
}

async function rmIfExists(filePath: string): Promise<void> {
  try {
    await fs.rm(filePath, { force: true });
  } catch (error) {
    const err = error as NodeJS.ErrnoException;
    if (err.code === "ENOENT") return;
    throw error;
  }
}

export async function listRuns(args: {
  artifactRootDir: string;
  isAlive?: (pid: number) => boolean;
  clearStaleLocks?: boolean;
}): Promise<DiscoveredRun[]> {
  const statesDir = path.join(args.artifactRootDir, "states");
  let names: string[];

  try {
    names = await fs.readdir(statesDir);
  } catch (error) {
    const err = error as NodeJS.ErrnoException;
    if (err.code === "ENOENT") return [];
    throw error;
  }

  const runs: DiscoveredRun[] = [];
  for (const name of names) {
    if (!name.endsWith(".json")) continue;
    const stateFilePath = path.join(statesDir, name);

    let state: OttoStateV1;
    try {
      state = await loadOttoState(stateFilePath);
    } catch {
      continue;
    }

    const lock = await readRunLockFile(state.lockFilePath);
    if (!lock) {
      runs.push({ state, stateFilePath, process: { status: "inactive" } });
      continue;
    }

    const stale = await isRunLockStale({ lock, isAlive: args.isAlive });
    if (stale) {
      if (args.clearStaleLocks ?? true) {
        await rmIfExists(state.lockFilePath);
      }
      runs.push({ state, stateFilePath, process: { status: "stale", lock } });
      continue;
    }

    runs.push({ state, stateFilePath, process: { status: "active", lock } });
  }

  runs.sort((a, b) => b.state.createdAt.localeCompare(a.state.createdAt));
  return runs;
}
