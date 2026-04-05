import { truncateText } from "./helpers.js";
import type { AgUiEvent } from "./types.js";

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value : undefined;
}

function summarizeRunEvent(runId: string, event: AgUiEvent) {
  if (event.type === "RUN_STARTED") return { title: "Run started", meta: event.runId || runId, body: `Run started for ${event.runId || runId}.` };
  if (event.type === "RUN_FINISHED") {
    const result = asRecord(event.result);
    const stoppedAtPhase = asString(result?.stoppedAtPhase);
    return { title: "Run finished", meta: stoppedAtPhase || "", body: stoppedAtPhase ? `Run completed and stopped at ${stoppedAtPhase}.` : "Run completed successfully." };
  }
  if (event.type === "RUN_ERROR") return { title: "Run error", meta: "", body: String(event.message || "Run error") };
  return null;
}

function summarizeMessageEvent(event: AgUiEvent) {
  if (event.type === "TEXT_MESSAGE_CONTENT") return { title: "Assistant message", meta: event.messageId || "", body: truncateText(String(event.delta || ""), 1200) };
  if (event.type === "TEXT_MESSAGE_START" || event.type === "TEXT_MESSAGE_END") return { title: event.type === "TEXT_MESSAGE_START" ? "Message started" : "Message ended", meta: event.messageId || "", body: "" };
  return null;
}

function summarizeToolEvent(event: AgUiEvent) {
  if (event.type === "TOOL_CALL_START") return { title: "Tool started", meta: event.toolCallName || event.toolCallId || "", body: `Tool call started: ${String(event.toolCallName || event.toolCallId || "unknown")}` };
  if (event.type === "TOOL_CALL_ARGS") return { title: "Tool input", meta: event.toolCallId || "", body: truncateText(String(event.delta || ""), 1200) };
  if (event.type === "TOOL_CALL_RESULT") return { title: "Tool result", meta: event.toolCallId || "", body: truncateText(String(event.content || ""), 1200) };
  if (event.type === "TOOL_CALL_END") return { title: "Tool ended", meta: event.toolCallId || "", body: "" };
  return null;
}

function summarizeCustomEvent(event: AgUiEvent) {
  if (event.type === "CUSTOM" && event.name === "otto.reasoning") {
    const value = asRecord(event.value);
    return { title: "Reasoning", meta: "", body: truncateText(asString(value?.text) || JSON.stringify(event.value || {}, null, 2), 1200) };
  }
  if (event.type === "CUSTOM" && event.name === "otto.control_plane") {
    const jobs = Array.isArray(event.value?.jobs) ? event.value.jobs.length : 0;
    const prompts = Array.isArray(event.value?.prompts) ? event.value.prompts.length : 0;
    return { title: "Control plane", meta: `jobs ${jobs} / prompts ${prompts}`, body: prompts > 0 ? `Operator input is required for ${prompts} prompt${prompts === 1 ? "" : "s"}.` : `No outstanding prompts. ${jobs} tracked job${jobs === 1 ? "" : "s"}.` };
  }
  if (event.type === "CUSTOM" && event.name === "otto.phase_transition") {
    const value = asRecord(event.value);
    const data = asRecord(value?.data);
    const from = asString(data?.from);
    const to = asString(data?.to);
    return { title: "Phase transition", meta: to || "", body: from && to ? `Workflow moved from ${from} to ${to}.` : "Workflow phase changed." };
  }
  if (event.type === "CUSTOM" && event.name === "otto.phase_entered") {
    const value = asRecord(event.value);
    const data = asRecord(value?.data);
    const phase = asString(data?.phase);
    const step = data?.step;
    return { title: "Phase entered", meta: phase || "", body: phase ? `Entered ${phase}${typeof step === "number" ? ` (step ${step})` : ""}.` : "Entered a workflow phase." };
  }
  if (event.type === "CUSTOM" && event.name === "otto.exec_start") {
    const value = asRecord(event.value);
    return { title: "Command started", meta: asString(value?.label) || "", body: truncateText((Array.isArray(value?.cmd) ? value?.cmd.join(" ") : asString(value?.label)) || "", 800) };
  }
  if (event.type === "CUSTOM" && event.name === "otto.exec_result") {
    const value = asRecord(event.value);
    const exitCode = value?.exitCode;
    const timedOut = value?.timedOut;
    const label = asString(value?.label) || "command";
    const summary = `${label} finished with exit=${exitCode}${timedOut ? " (timed out)" : ""}.`;
    return { title: "Command finished", meta: label, body: summary };
  }
  return null;
}

function summarizeRawEvent(event: AgUiEvent) {
  const raw = asRecord(event.event) || asRecord(event.rawEvent);
  if (!raw) {
    return { title: "Raw runner event", meta: event.source || "", body: truncateText(JSON.stringify(event.event || event.rawEvent || {}, null, 2), 1200) };
  }
  const type = asString(raw.type);
  const item = asRecord(raw.item);
  if (item && asString(item.type) === "agent_message") {
    return { title: "Runner message", meta: event.source || "", body: truncateText(asString(item.text) || JSON.stringify(item, null, 2), 1200) };
  }
  if (item && asString(item.type) === "command_execution") {
    const command = asString(item.command) || "command";
    const output = asString(item.aggregated_output);
    return { title: "Runner command", meta: event.source || "", body: output ? truncateText(output, 1200) : command };
  }
  if (type === "result") {
    return { title: "Runner result", meta: event.source || "", body: truncateText(asString(raw.result) || JSON.stringify(raw, null, 2), 1200) };
  }
  return { title: type || "Raw runner event", meta: event.source || "", body: truncateText(JSON.stringify(raw, null, 2), 1200) };
}

export function summarizeAgUiEvent(runId: string, event: AgUiEvent): { title: string; meta: string; body: string } {
  return (
    summarizeRunEvent(runId, event) ??
    summarizeMessageEvent(event) ??
    summarizeToolEvent(event) ??
    summarizeCustomEvent(event) ??
    (event.type === "RAW"
      ? summarizeRawEvent(event)
      : { title: event.type || "Event", meta: event.name || event.source || "", body: truncateText(JSON.stringify(event, null, 2), 1200) })
  );
}
