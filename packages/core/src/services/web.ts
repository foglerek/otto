import fs from "node:fs/promises";
import path from "node:path";

import type { OttoConfig } from "@otto/config";
import type { OttoExecEvent, OttoRunEvent } from "../workflow/events.js";

import { resolveArtifactPaths } from "../artifacts.js";
import { findNearestOttoConfigPath, loadOttoConfig } from "../cli/config.js";
import { readRunLockFile } from "../locks/run-lock.js";
import { listRuns } from "../runs/listing.js";
import { getStateFilePathForRunId } from "../runs/paths.js";
import { loadOttoState, type OttoStateV1 } from "../state.js";
import { listManagedTicketIds } from "../tickets/list.js";
import { getDecisionCardsPath, getFinalReportPath, getPlanFilePath } from "../workflow/paths.js";

export interface OttoWebRepoContext {
  cwd: string;
  configPath: string;
  config: OttoConfig;
  mainRepoPath: string;
  artifactRootDir: string;
}

export interface OttoWebRunSummary {
  runId: string;
  ticketSlug: string;
  createdAt: string;
  branchName: string;
  baseBranch: string;
  phase: string | null;
  processStatus: "active" | "inactive" | "stale";
  lockPid: number | null;
  needsUserInput: boolean;
  taskQueueLength: number;
  planAvailable: boolean;
  finalReportAvailable: boolean;
}

export interface OttoWebDashboardData {
  repoPath: string;
  configPath: string;
  artifactRootDir: string;
  defaultRunnerId: string | null;
  subagentsEnabled: boolean;
  onboardingStatus: string | null;
  ticketsCount: number;
  runCounts: {
    total: number;
    active: number;
    inactive: number;
    stale: number;
  };
  runs: OttoWebRunSummary[];
}

export interface OttoWebArtifactPreview {
  id: string;
  title: string;
  path: string;
  exists: boolean;
  language: "markdown" | "json" | "log" | "text";
  content: string | null;
  truncated: boolean;
}

export interface OttoWebRunDetailData {
  summary: OttoWebRunSummary;
  ticketFilePath: string;
  worktreePath: string;
  stateFilePath: string;
  runFiles: string[];
  artifacts: OttoWebArtifactPreview[];
  recentEvents: OttoRunEvent[];
  recentExecs: OttoExecEvent[];
}

const ARTIFACT_MAX_CHARS = 16_000;
const EVENT_TAIL_COUNT = 24;

export async function resolveWebRepoContext(cwd: string): Promise<OttoWebRepoContext> {
  const resolvedCwd = path.resolve(cwd);
  const configPath = await findNearestOttoConfigPath(resolvedCwd);
  const config = await loadOttoConfig(configPath);
  const mainRepoPath = await config.worktree.adapter.getMainRepoPath(resolvedCwd);
  const artifactRootDir = resolveArtifactPaths({
    mainRepoPath,
    artifactRoot: config.paths?.artifactRoot,
  }).rootDir;

  return {
    cwd: resolvedCwd,
    configPath,
    config,
    mainRepoPath,
    artifactRootDir,
  };
}

function summarizeRun(state: OttoStateV1, processStatus: OttoWebRunSummary["processStatus"], lockPid: number | null): OttoWebRunSummary {
  const queue = Array.isArray(state.workflow?.taskQueue) ? state.workflow?.taskQueue : [];
  return {
    runId: state.runId,
    ticketSlug: state.ticket.slug,
    createdAt: state.createdAt,
    branchName: state.worktree.branchName,
    baseBranch: state.worktree.baseBranch,
    phase: state.workflow?.phase ?? null,
    processStatus,
    lockPid,
    needsUserInput: state.workflow?.needsUserInput === true,
    taskQueueLength: queue.length,
    planAvailable: false,
    finalReportAvailable: false,
  };
}

async function pathExists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function withArtifactFlags(summary: OttoWebRunSummary, state: OttoStateV1): Promise<OttoWebRunSummary> {
  const [planAvailable, finalReportAvailable] = await Promise.all([
    pathExists(getPlanFilePath(state)),
    pathExists(getFinalReportPath(state)),
  ]);
  return {
    ...summary,
    planAvailable,
    finalReportAvailable,
  };
}

async function readOptionalJson(filePath: string): Promise<Record<string, unknown> | null> {
  try {
    const raw = await fs.readFile(filePath, "utf8");
    const value = JSON.parse(raw) as unknown;
    if (!value || typeof value !== "object") {
      return null;
    }
    return value as Record<string, unknown>;
  } catch {
    return null;
  }
}

async function readArtifactPreview(args: {
  id: string;
  title: string;
  filePath: string;
  language: OttoWebArtifactPreview["language"];
}): Promise<OttoWebArtifactPreview> {
  try {
    const raw = await fs.readFile(args.filePath, "utf8");
    const truncated = raw.length > ARTIFACT_MAX_CHARS;
    return {
      id: args.id,
      title: args.title,
      path: args.filePath,
      exists: true,
      language: args.language,
      content: truncated ? `${raw.slice(0, ARTIFACT_MAX_CHARS)}\n...[truncated ${raw.length - ARTIFACT_MAX_CHARS} chars]` : raw,
      truncated,
    };
  } catch {
    return {
      id: args.id,
      title: args.title,
      path: args.filePath,
      exists: false,
      language: args.language,
      content: null,
      truncated: false,
    };
  }
}

async function readJsonlTail<T extends object>(filePath: string, maxItems = EVENT_TAIL_COUNT): Promise<T[]> {
  try {
    const raw = await fs.readFile(filePath, "utf8");
    const lines = raw
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line.length > 0)
      .slice(-maxItems);

    const parsed: T[] = [];
    for (const line of lines) {
      try {
        parsed.push(JSON.parse(line) as T);
      } catch {
        // ignore malformed line
      }
    }
    return parsed;
  } catch {
    return [];
  }
}

async function listRunFiles(runDir: string): Promise<string[]> {
  try {
    const names = await fs.readdir(runDir);
    return names.sort();
  } catch {
    return [];
  }
}

export async function loadWebDashboardData(cwd: string): Promise<OttoWebDashboardData> {
  const context = await resolveWebRepoContext(cwd);
  const [tickets, runs, onboarding] = await Promise.all([
    listManagedTicketIds(context.mainRepoPath),
    listRuns({ artifactRootDir: context.artifactRootDir }),
    readOptionalJson(path.join(context.artifactRootDir, "states", "onboarding.json")),
  ]);

  const summaries = await Promise.all(
    runs.map(async (run) => {
      const lockPid = run.process.status === "active" || run.process.status === "stale"
        ? run.process.lock.pid
        : null;
      return await withArtifactFlags(
        summarizeRun(run.state, run.process.status, lockPid),
        run.state,
      );
    }),
  );

  const active = summaries.filter((run) => run.processStatus === "active").length;
  const stale = summaries.filter((run) => run.processStatus === "stale").length;
  const inactive = summaries.length - active - stale;

  return {
    repoPath: context.mainRepoPath,
    configPath: context.configPath,
    artifactRootDir: context.artifactRootDir,
    defaultRunnerId: context.config.runners.default?.id ?? null,
    subagentsEnabled: context.config.subagents?.enabled === true,
    onboardingStatus: typeof onboarding?.status === "string" ? onboarding.status : null,
    ticketsCount: tickets.length,
    runCounts: {
      total: summaries.length,
      active,
      inactive,
      stale,
    },
    runs: summaries,
  };
}

export async function loadWebRunDetailData(args: {
  cwd: string;
  runId: string;
}): Promise<OttoWebRunDetailData> {
  const context = await resolveWebRepoContext(args.cwd);
  const discoveredRuns = await listRuns({ artifactRootDir: context.artifactRootDir });
  const discovered = discoveredRuns.find((run) => run.state.runId === args.runId) ?? null;
  const stateFilePath = getStateFilePathForRunId({
    artifactRootDir: context.artifactRootDir,
    runId: args.runId,
  });
  const state = await loadOttoState(stateFilePath);
  const lock = await readRunLockFile(state.lockFilePath);
  const processStatus: OttoWebRunSummary["processStatus"] = discovered?.process.status ?? (lock ? "active" : "inactive");
  const lockPid = discovered?.process.status === "active" || discovered?.process.status === "stale"
    ? discovered.process.lock.pid
    : lock?.pid ?? null;
  const summary = await withArtifactFlags(summarizeRun(state, processStatus, lockPid), state);

  const [runFiles, ticket, plan, decisionCards, finalReport, recentEvents, recentExecs] = await Promise.all([
    listRunFiles(state.runDir),
    readArtifactPreview({
      id: "ticket",
      title: "Ticket",
      filePath: state.ticket.filePath,
      language: "markdown",
    }),
    readArtifactPreview({
      id: "plan",
      title: "Plan",
      filePath: getPlanFilePath(state),
      language: "markdown",
    }),
    readArtifactPreview({
      id: "decision-cards",
      title: "Decision Cards",
      filePath: getDecisionCardsPath(state),
      language: "json",
    }),
    readArtifactPreview({
      id: "final-report",
      title: "Final Report",
      filePath: getFinalReportPath(state),
      language: "markdown",
    }),
    readJsonlTail<OttoRunEvent>(path.join(state.runDir, "events.jsonl")),
    readJsonlTail<OttoExecEvent>(path.join(state.runDir, "exec.jsonl")),
  ]);

  return {
    summary,
    ticketFilePath: state.ticket.filePath,
    worktreePath: state.worktree.worktreePath,
    stateFilePath: state.stateFilePath,
    runFiles,
    artifacts: [ticket, plan, decisionCards, finalReport],
    recentEvents,
    recentExecs,
  };
}
