import fs from "node:fs/promises";
import path from "node:path";

import { EventType } from "@ag-ui/core";

import type { OttoExecEvent, OttoExecStartEvent, OttoRunEvent } from "./workflow/events.js";

export type OttoAgUiEvent = Record<string, unknown> & {
  type: EventType;
  timestamp?: number;
  rawEvent?: unknown;
};

export interface OttoAgUiEventLogger {
  append(event: OttoAgUiEvent): Promise<void>;
  appendMany(events: OttoAgUiEvent[]): Promise<void>;
}

function toTimestamp(value: string): number | undefined {
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function buildThreadId(runId: string): string {
  return runId;
}

function appendJsonLine(filePath: string, value: unknown): Promise<void> {
  return fs.appendFile(filePath, `${JSON.stringify(value)}\n`, "utf8");
}

export function getAgUiEventsPath(runDir: string): string {
  return path.join(runDir, "ag-ui-events.jsonl");
}

export function createAgUiEventLogger(args: {
  runDir: string;
}): OttoAgUiEventLogger {
  const filePath = getAgUiEventsPath(args.runDir);

  return {
    async append(event) {
      await fs.mkdir(path.dirname(filePath), { recursive: true });
      await appendJsonLine(filePath, event);
    },

    async appendMany(events) {
      if (events.length === 0) {
        return;
      }
      await fs.mkdir(path.dirname(filePath), { recursive: true });
      await fs.appendFile(
        filePath,
        `${events.map((event) => JSON.stringify(event)).join("\n")}\n`,
        "utf8",
      );
    },
  };
}

function buildCustomEvent(args: {
  name: string;
  value: unknown;
  timestamp?: number;
  rawEvent?: unknown;
}): OttoAgUiEvent {
  return {
    type: EventType.CUSTOM,
    name: args.name,
    value: args.value,
    ...(args.timestamp !== undefined ? { timestamp: args.timestamp } : {}),
    ...(args.rawEvent !== undefined ? { rawEvent: args.rawEvent } : {}),
  };
}

export function mapRunEventToAgUi(event: OttoRunEvent): OttoAgUiEvent[] {
  const timestamp = toTimestamp(event.at);
  const threadId = buildThreadId(event.runId);

  if (event.type === "run_started") {
    return [
      {
        type: EventType.RUN_STARTED,
        threadId,
        runId: event.runId,
        ...(event.data ? { input: event.data } : {}),
        ...(timestamp !== undefined ? { timestamp } : {}),
        rawEvent: event,
      },
    ];
  }

  if (event.type === "run_stopped") {
    return [
      {
        type: EventType.RUN_FINISHED,
        threadId,
        runId: event.runId,
        ...(event.data ? { result: event.data } : {}),
        ...(timestamp !== undefined ? { timestamp } : {}),
        rawEvent: event,
      },
    ];
  }

  if (event.type === "run_failed") {
    return [
      {
        type: EventType.RUN_ERROR,
        message:
          typeof event.data?.error === "string"
            ? event.data.error
            : "Otto run failed.",
        code: "OTTO_RUN_FAILED",
        ...(timestamp !== undefined ? { timestamp } : {}),
        rawEvent: event,
      },
    ];
  }

  if (event.type === "phase_transition") {
    const phase = typeof event.data?.toPhase === "string" ? event.data.toPhase : "unknown";
    return [
      {
        type: EventType.STEP_STARTED,
        stepName: phase,
        ...(timestamp !== undefined ? { timestamp } : {}),
        rawEvent: event,
      },
      buildCustomEvent({
        name: "otto.phase_transition",
        value: event,
        timestamp,
        rawEvent: event,
      }),
    ];
  }

  if (event.type === "phase_entered") {
    const phase = typeof event.data?.phase === "string" ? event.data.phase : "unknown";
    return [
      {
        type: EventType.STEP_FINISHED,
        stepName: phase,
        ...(timestamp !== undefined ? { timestamp } : {}),
        rawEvent: event,
      },
      buildCustomEvent({
        name: "otto.phase_entered",
        value: event,
        timestamp,
        rawEvent: event,
      }),
    ];
  }

  return [
    buildCustomEvent({
      name: `otto.${event.type}`,
      value: event,
      timestamp,
      rawEvent: event,
    }),
  ];
}

export function mapExecStartToAgUi(event: OttoExecStartEvent): OttoAgUiEvent[] {
  const timestamp = toTimestamp(event.at);
  return [
    {
      type: EventType.TOOL_CALL_START,
      toolCallId: event.execId,
      toolCallName: event.label,
      ...(timestamp !== undefined ? { timestamp } : {}),
      rawEvent: event,
    },
    {
      type: EventType.TOOL_CALL_ARGS,
      toolCallId: event.execId,
      delta: JSON.stringify({ cmd: event.cmd, cwd: event.cwd }),
      ...(timestamp !== undefined ? { timestamp } : {}),
      rawEvent: event,
    },
    buildCustomEvent({
      name: "otto.exec_start",
      value: event,
      timestamp,
      rawEvent: event,
    }),
  ];
}

export function mapExecEventToAgUi(event: OttoExecEvent): OttoAgUiEvent[] {
  const timestamp = toTimestamp(event.at);
  const resultText = [
    `exitCode=${event.exitCode}`,
    `timedOut=${event.timedOut}`,
    `durationMs=${event.durationMs}`,
    event.stdoutPreview ? `stdout:\n${event.stdoutPreview}` : null,
    event.stderrPreview ? `stderr:\n${event.stderrPreview}` : null,
  ]
    .filter((part) => typeof part === "string" && part.length > 0)
    .join("\n\n");

  return [
    {
      type: EventType.TOOL_CALL_END,
      toolCallId: event.execId,
      ...(timestamp !== undefined ? { timestamp } : {}),
      rawEvent: event,
    },
    {
      type: EventType.TOOL_CALL_RESULT,
      messageId: `tool-result-${event.execId}`,
      toolCallId: event.execId,
      content: resultText,
      role: "tool",
      ...(timestamp !== undefined ? { timestamp } : {}),
      rawEvent: event,
    },
    buildCustomEvent({
      name: "otto.exec_result",
      value: event,
      timestamp,
      rawEvent: event,
    }),
  ];
}
