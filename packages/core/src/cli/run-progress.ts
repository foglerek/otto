import process from "node:process";

import type {
  OttoExecEvent,
  OttoExecStartEvent,
  OttoRunEvent,
} from "../workflow/events.js";
import { isJsonOutputMode } from "./output.js";

function writeInfo(message: string): void {
  if (isJsonOutputMode()) return;
  process.stdout.write(`${message}\n`);
}

function writeWarn(message: string): void {
  if (isJsonOutputMode()) return;
  process.stderr.write(`${message}\n`);
}

function summarizeErrorForTerminal(message: string, maxChars = 800): string {
  const normalized = message.replace(/\s+/g, " ").trim();
  if (normalized.length <= maxChars) {
    return normalized;
  }
  return `${normalized.slice(0, maxChars)} ... [truncated ${normalized.length - maxChars} chars]`;
}

function shouldShowExecStart(): boolean {
  const raw = process.env.OTTO_PROGRESS_EXEC_START;
  if (!raw) {
    return true;
  }
  return !/^(0|false|no|off)$/i.test(raw.trim());
}

export function reportRunEventToTerminal(event: OttoRunEvent): void {
  if (event.type === "phase_entered") {
    const phase = typeof event.data?.phase === "string" ? event.data.phase : "unknown";
    writeInfo(`[phase] ${phase}`);
    return;
  }

  if (event.type === "run_failed") {
    const message =
      typeof event.data?.error === "string"
        ? event.data.error
        : "Run failed with an unknown error.";
    writeWarn(`[run failed] ${summarizeErrorForTerminal(message)}`);
    return;
  }

  if (event.type === "ticket_ingestion_failed_before_artifact") {
    const message =
      typeof event.data?.error === "string"
        ? event.data.error
        : "Ticket ingestion failed before writing plan artifacts.";
    writeWarn(`[ticket-ingestion] ${summarizeErrorForTerminal(message)}`);
  }
}

export function reportExecStartToTerminal(event: OttoExecStartEvent): void {
  if (isJsonOutputMode() || !shouldShowExecStart()) return;
  writeInfo(`[exec] ${event.label} (started)`);
}

export function reportExecEventToTerminal(event: OttoExecEvent): void {
  if (isJsonOutputMode()) return;
  const status = event.exitCode === 0 ? "ok" : `exit ${event.exitCode}`;
  writeInfo(`[exec] ${event.label} (${status}, ${event.durationMs}ms)`);
}
