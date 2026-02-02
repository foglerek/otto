import path from "node:path";

export function isRunIdSafe(runId: string): boolean {
  if (!runId || runId.includes("/") || runId.includes("\\")) return false;
  if (runId.includes("..")) return false;
  if (runId.endsWith(".json")) return false;
  return true;
}

export function getRunDirForId(args: { artifactRootDir: string; runId: string }): string {
  if (!isRunIdSafe(args.runId)) {
    throw new Error(`Invalid run id: ${args.runId}`);
  }
  return path.join(args.artifactRootDir, "runs", args.runId);
}

export function getStateFilePathForRunId(args: {
  artifactRootDir: string;
  runId: string;
}): string {
  if (!isRunIdSafe(args.runId)) {
    throw new Error(`Invalid run id: ${args.runId}`);
  }
  return path.join(args.artifactRootDir, "states", `run-${args.runId}.json`);
}
