import process from "node:process";

import type { OttoExecEvent, OttoRunEvent } from "../workflow/events.js";
import { isJsonOutputMode } from "./output.js";

function writeInfo(message: string): void {
  if (isJsonOutputMode()) return;
  process.stdout.write(`${message}\n`);
}

function writeWarn(message: string): void {
  if (isJsonOutputMode()) return;
  process.stderr.write(`${message}\n`);
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
    writeWarn(`[run failed] ${message}`);
    return;
  }

  if (event.type === "ticket_ingestion_failed_before_artifact") {
    const message =
      typeof event.data?.error === "string"
        ? event.data.error
        : "Ticket ingestion failed before writing plan artifacts.";
    writeWarn(`[ticket-ingestion] ${message}`);
  }
}

export function reportExecEventToTerminal(event: OttoExecEvent): void {
  if (isJsonOutputMode()) return;
  const status = event.exitCode === 0 ? "ok" : `exit ${event.exitCode}`;
  writeInfo(`[exec] ${event.label} (${status}, ${event.durationMs}ms)`);
}
