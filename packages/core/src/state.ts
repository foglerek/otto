import fs from "node:fs/promises";
import path from "node:path";

export interface OttoStateV1 {
  version: 1;
  runId: string;
  createdAt: string;
  configPath?: string;
  mainRepoPath: string;
  artifactRootDir: string;
  workflow?: {
    phase?: OttoWorkflowPhase;
    needsUserInput?: boolean;
    runDir?: string;
    planFilePath?: string;
    decisionCardsPath?: string;
    techLeadSessionId?: string;
    taskQueue?: string[];
    taskAgentSessions?: Record<string, string | null>;
    reviewerSessions?: Record<string, string | null>;
    autoRetryCounts?: Record<string, number>;
  };
  ticket: {
    date: string;
    slug: string;
    filePath: string;
  };
  worktree: {
    worktreePath: string;
    branchName: string;
    baseBranch: string;
  };
  env?: Record<string, string>;
  testEnv?: Record<string, string>;
}

export type OttoWorkflowPhase =
  | "ticket-created"
  | "ticket-ingested"
  | "decision-cards"
  | "plan-feedback"
  | "plan-created"
  | "task-splitting"
  | "task-feedback"
  | "execution"
  | "user-feedback"
  | "integration"
  | "finalize"
  | "cleanup";

function assertString(value: unknown, name: string): asserts value is string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`Invalid state: expected ${name} to be a non-empty string`);
  }
}

export function resolveConfigPathFromState(args: {
  state: OttoStateV1;
  overridePath?: string;
}): string {
  if (args.overridePath) {
    return path.resolve(args.overridePath);
  }
  if (args.state.configPath) {
    return path.resolve(args.state.configPath);
  }
  return path.join(args.state.mainRepoPath, "otto.config.ts");
}

export async function loadOttoState(
  stateFilePath: string,
): Promise<OttoStateV1> {
  const resolved = path.resolve(stateFilePath);
  const raw = await fs.readFile(resolved, "utf8");
  const data: unknown = JSON.parse(raw);

  if (!data || typeof data !== "object") {
    throw new Error(`Invalid state JSON at ${resolved}`);
  }

  const s = data as Partial<OttoStateV1>;
  if (s.version !== 1) {
    throw new Error(
      `Unsupported state version: ${String(s.version)} (expected 1)`,
    );
  }

  assertString(s.runId, "runId");
  assertString(s.createdAt, "createdAt");
  assertString(s.mainRepoPath, "mainRepoPath");
  assertString(s.artifactRootDir, "artifactRootDir");

  if (!s.ticket || typeof s.ticket !== "object") {
    throw new Error("Invalid state: expected ticket object");
  }
  assertString(s.ticket.date, "ticket.date");
  assertString(s.ticket.slug, "ticket.slug");
  assertString(s.ticket.filePath, "ticket.filePath");

  if (!s.worktree || typeof s.worktree !== "object") {
    throw new Error("Invalid state: expected worktree object");
  }
  assertString(s.worktree.worktreePath, "worktree.worktreePath");
  assertString(s.worktree.branchName, "worktree.branchName");
  assertString(s.worktree.baseBranch, "worktree.baseBranch");

  return s as OttoStateV1;
}
