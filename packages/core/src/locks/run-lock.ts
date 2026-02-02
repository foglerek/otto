import fs from "node:fs/promises";
import path from "node:path";

export interface RunLockFile {
  pid: number;
  startedAt: string;
  runId: string;
  stateFilePath: string;
}

export type IsPidAlive = (pid: number) => boolean | Promise<boolean>;

export function getRunLockFilePath(args: {
  artifactRootDir: string;
  runId: string;
}): string {
  return path.join(args.artifactRootDir, "locks", `run-${args.runId}.json`);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function assertRunLockFile(value: unknown): asserts value is RunLockFile {
  if (!value || typeof value !== "object") {
    throw new Error("Invalid run lock: expected object");
  }
  const lock = value as RunLockFile;
  if (typeof lock.pid !== "number" || !Number.isFinite(lock.pid)) {
    throw new Error("Invalid run lock: expected pid to be a number");
  }
  if (!isNonEmptyString(lock.startedAt)) {
    throw new Error("Invalid run lock: expected startedAt to be a string");
  }
  if (!isNonEmptyString(lock.runId)) {
    throw new Error("Invalid run lock: expected runId to be a string");
  }
  if (!isNonEmptyString(lock.stateFilePath)) {
    throw new Error("Invalid run lock: expected stateFilePath to be a string");
  }
}

async function writeJsonAtomic(
  filePath: string,
  value: unknown,
): Promise<void> {
  const resolved = path.resolve(filePath);
  const dir = path.dirname(resolved);
  await fs.mkdir(dir, { recursive: true });

  const tmp = `${resolved}.tmp-${process.pid}-${Date.now()}`;
  const body = JSON.stringify(value, null, 2) + "\n";
  await fs.writeFile(tmp, body, "utf8");
  await fs.rename(tmp, resolved);
}

export async function writeRunLockFile(
  filePath: string,
  lock: RunLockFile,
): Promise<void> {
  await writeJsonAtomic(filePath, lock);
}

export async function readRunLockFile(
  filePath: string,
): Promise<RunLockFile | null> {
  const resolved = path.resolve(filePath);
  let raw: string;
  try {
    raw = await fs.readFile(resolved, "utf8");
  } catch (error) {
    if (error && typeof error === "object" && "code" in error) {
      if (error.code === "ENOENT") return null;
    }
    throw error;
  }

  const data: unknown = JSON.parse(raw);
  assertRunLockFile(data);
  return data;
}

function defaultIsPidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    if (error && typeof error === "object" && "code" in error) {
      return error.code === "EPERM";
    }
    return false;
  }
}

export async function isRunLockStale(args: {
  lock: RunLockFile;
  isAlive?: IsPidAlive;
}): Promise<boolean> {
  const isAlive = args.isAlive ?? defaultIsPidAlive;
  const alive = await isAlive(args.lock.pid);
  return !alive;
}

export function looksLikeOttoProcessName(nameOrCmdline: string): boolean {
  if (!nameOrCmdline) return false;
  return /\botto\b/i.test(nameOrCmdline);
}
