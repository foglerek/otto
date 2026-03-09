import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";

import { createOttoStateStore } from "../../workflow/state-store.js";
import { getStateFilePathForRunId } from "../../runs/paths.js";
import { isRunLockStale, readRunLockFile, writeRunLockFile } from "../../locks/run-lock.js";

export function parseTicketMetaFromId(ticketId: string): { date: string; slug: string } {
  const match = ticketId.match(/^(\d{4}-\d{2}-\d{2})-(.+)$/);
  if (!match) {
    throw new Error(`Invalid ticket id (expected YYYY-MM-DD-<slug>): ${ticketId}`);
  }
  return { date: match[1], slug: match[2] };
}

export async function writeStateFile(state: object, stateFilePath: string): Promise<void> {
  const store = createOttoStateStore({ filePath: stateFilePath, initialState: state });
  await store.save();
}

export async function acquireRunLock(args: {
  lockFilePath: string;
  runId: string;
  stateFilePath: string;
}): Promise<void> {
  const existing = await readRunLockFile(args.lockFilePath);
  if (existing) {
    const stale = await isRunLockStale({ lock: existing });
    if (!stale) {
      throw new Error(`Run is active (pid ${existing.pid}).`);
    }
    await fs.rm(args.lockFilePath, { force: true });
  }

  await writeRunLockFile(args.lockFilePath, {
    pid: process.pid,
    startedAt: new Date().toISOString(),
    runId: args.runId,
    stateFilePath: args.stateFilePath,
  });
}

export async function releaseRunLock(lockFilePath: string): Promise<void> {
  await fs.rm(lockFilePath, { force: true });
}

export function resolveStateFilePath(args: {
  arg: string;
  artifactRootDir: string;
}): string {
  if (args.arg.includes("/") || args.arg.includes("\\") || args.arg.endsWith(".json")) {
    return path.resolve(args.arg);
  }
  return getStateFilePathForRunId({
    artifactRootDir: args.artifactRootDir,
    runId: args.arg,
  });
}
