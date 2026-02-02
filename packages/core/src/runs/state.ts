import path from "node:path";

import type { OttoStateV1 } from "../state.js";
import { getRunLockFilePath } from "../locks/run-lock.js";
import { extractSlugFromTicketId } from "../tickets/paths.js";

import { getRunDirForId, getStateFilePathForRunId } from "./paths.js";

function extractDateFromTicketId(ticketId: string): string {
  const match = ticketId.match(/^(\d{4}-\d{2}-\d{2})-/);
  if (!match) {
    throw new Error(`Ticket id must start with YYYY-MM-DD-: ${ticketId}`);
  }
  return match[1];
}

export function buildInitialRunState(args: {
  mainRepoPath: string;
  artifactRootDir: string;
  configPath?: string;
  ticketId: string;
  ticketFilePath: string;
  worktreePath: string;
  branchName: string;
  baseBranch: string;
  createdAt?: Date;
  env?: Record<string, string>;
  testEnv?: Record<string, string>;
}): OttoStateV1 {
  const runId = args.ticketId;
  const createdAt = (args.createdAt ?? new Date()).toISOString();

  const stateFilePath = path.resolve(
    getStateFilePathForRunId({ artifactRootDir: args.artifactRootDir, runId }),
  );
  const runDir = path.resolve(
    getRunDirForId({ artifactRootDir: args.artifactRootDir, runId }),
  );
  const lockFilePath = path.resolve(
    getRunLockFilePath({ artifactRootDir: args.artifactRootDir, runId }),
  );

  const ticketDate = extractDateFromTicketId(args.ticketId);
  const ticketSlug = extractSlugFromTicketId(args.ticketId) ?? args.ticketId;

  return {
    version: 1,
    runId,
    createdAt,
    configPath: args.configPath ? path.resolve(args.configPath) : undefined,
    mainRepoPath: path.resolve(args.mainRepoPath),
    artifactRootDir: path.resolve(args.artifactRootDir),
    stateFilePath,
    runDir,
    lockFilePath,
    workflow: {
      phase: "ticket-created",
      needsUserInput: false,
      taskQueue: [],
      taskAgentSessions: {},
      reviewerSessions: {},
      autoRetryCounts: {},
    },
    ticket: {
      date: ticketDate,
      slug: ticketSlug,
      filePath: path.resolve(args.ticketFilePath),
    },
    worktree: {
      worktreePath: path.resolve(args.worktreePath),
      branchName: args.branchName,
      baseBranch: args.baseBranch,
    },
    env: args.env,
    testEnv: args.testEnv,
  };
}
