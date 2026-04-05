import fs from "node:fs/promises";
import path from "node:path";

export interface OttoRunEvent {
  at: string;
  runId: string;
  type: string;
  data?: Record<string, unknown>;
}

export interface OttoExecEvent {
  at: string;
  runId: string;
  execId: string;
  label: string;
  cmd: string[];
  cwd: string;
  exitCode: number;
  timedOut: boolean;
  durationMs: number;
  stdoutBytes: number;
  stderrBytes: number;
  stdoutPreview?: string;
  stderrPreview?: string;
}

export interface OttoExecStartEvent {
  at: string;
  runId: string;
  execId: string;
  label: string;
  cmd: string[];
  cwd: string;
}

export interface OttoRunEventLogger {
  append(event: OttoRunEvent): Promise<void>;
  appendExec(event: OttoExecEvent): Promise<void>;
}

async function appendJsonLine(filePath: string, value: unknown): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.appendFile(filePath, `${JSON.stringify(value)}\n`, "utf8");
}

export function createRunEventLogger(args: {
  runId: string;
  runDir: string;
}): OttoRunEventLogger {
  const eventsPath = path.join(args.runDir, "events.jsonl");
  const execPath = path.join(args.runDir, "exec.jsonl");

  return {
    async append(event) {
      await appendJsonLine(eventsPath, event);
    },

    async appendExec(event) {
      await appendJsonLine(execPath, event);
    },
  };
}

export async function emitRunEvent(args: {
  logger: OttoRunEventLogger;
  runId: string;
  type: string;
  data?: Record<string, unknown>;
}): Promise<void> {
  await args.logger.append({
    at: new Date().toISOString(),
    runId: args.runId,
    type: args.type,
    data: args.data,
  });
}
