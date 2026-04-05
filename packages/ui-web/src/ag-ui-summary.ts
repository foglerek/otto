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
  if (event.type === "TEXT_MESSAGE_CONTENT") return { title: "Assistant update", meta: "", body: truncateText(String(event.delta || ""), 1200) };
  if (event.type === "TEXT_MESSAGE_START" || event.type === "TEXT_MESSAGE_END") return { title: event.type === "TEXT_MESSAGE_START" ? "Assistant is responding" : "Assistant finished responding", meta: "", body: "" };
  return null;
}

function summarizeToolEvent(event: AgUiEvent) {
  if (event.type === "TOOL_CALL_START") return { title: `Starting ${String(event.toolCallName || "tool")}`, meta: "", body: `Otto started ${String(event.toolCallName || event.toolCallId || "a tool call")}.` };
  if (event.type === "TOOL_CALL_ARGS") return { title: `Preparing ${String(event.toolCallName || "tool")}`, meta: "", body: summarizeToolArgs(event.delta) };
  if (event.type === "TOOL_CALL_RESULT") return { title: `Finished ${String(event.toolCallName || "tool")}`, meta: "", body: truncateText(String(event.content || ""), 1200) };
  if (event.type === "TOOL_CALL_END") return { title: `Completed ${String(event.toolCallName || "tool")}`, meta: "", body: "" };
  return null;
}

function summarizeToolArgs(delta: unknown): string {
  if (typeof delta !== "string") {
    return truncateText(JSON.stringify(delta ?? {}, null, 2), 1200);
  }
  try {
    const parsed = JSON.parse(delta) as unknown;
    const record = asRecord(parsed);
    if (!record) {
      return truncateText(delta, 1200);
    }
    const cmd = Array.isArray(record.cmd) ? record.cmd.join(" ") : asString(record.command);
    const cwd = asString(record.cwd);
    const input = asRecord(record.input);
    const inputCommand = input ? asString(input.command) : undefined;
    if (cmd || inputCommand) {
      const lines = [cmd || inputCommand || "", cwd ? `cwd: ${cwd}` : ""].filter(Boolean);
      return truncateText(lines.join("\n"), 1200);
    }
    return truncateText(JSON.stringify(record, null, 2), 1200);
  } catch {
    return truncateText(delta, 1200);
  }
}

function summarizeCustomEvent(event: AgUiEvent) {
  const handlers: Record<string, () => { title: string; meta: string; body: string }> = {
    "otto.reasoning": () => summarizeReasoningEvent(event),
    "otto.control_plane": () => summarizeControlPlaneEvent(event),
    "otto.phase_transition": () => summarizePhaseTransition(event),
    "otto.phase_entered": () => summarizePhaseEntered(event),
    "otto.exec_start": () => summarizeExecStart(event),
    "otto.exec_result": () => summarizeExecResult(event),
  };
  if (event.type !== "CUSTOM" || !event.name || !handlers[event.name]) {
    return null;
  }
  return handlers[event.name]();
}

function summarizeReasoningEvent(event: AgUiEvent) {
  const value = asRecord(event.value);
  return { title: "Thinking", meta: "", body: truncateText(asString(value?.text) || JSON.stringify(event.value || {}, null, 2), 1200) };
}

function summarizeControlPlaneEvent(event: AgUiEvent) {
  const jobs = Array.isArray(event.value?.jobs) ? event.value.jobs.length : 0;
  const prompts = Array.isArray(event.value?.prompts) ? event.value.prompts.length : 0;
  return { title: prompts > 0 ? "Waiting for operator" : "Control plane update", meta: `jobs ${jobs} / prompts ${prompts}`, body: prompts > 0 ? `Operator input is required for ${prompts} prompt${prompts === 1 ? "" : "s"}.` : `No outstanding prompts. ${jobs} tracked job${jobs === 1 ? "" : "s"}.` };
}

function summarizePhaseTransition(event: AgUiEvent) {
  const value = asRecord(event.value);
  const data = asRecord(value?.data);
  const from = asString(data?.from);
  const to = asString(data?.to);
  return { title: to ? `Moved into ${to}` : "Workflow phase changed", meta: "", body: from && to ? `Workflow moved from ${from} to ${to}.` : "Workflow phase changed." };
}

function summarizePhaseEntered(event: AgUiEvent) {
  const value = asRecord(event.value);
  const data = asRecord(value?.data);
  const phase = asString(data?.phase);
  const step = data?.step;
  return { title: phase ? `Starting ${phase}` : "Entered workflow phase", meta: "", body: phase ? `Entered ${phase}${typeof step === "number" ? ` (step ${step})` : ""}.` : "Entered a workflow phase." };
}

function summarizeExecStart(event: AgUiEvent) {
  const value = asRecord(event.value);
  return { title: `Running ${asString(value?.label) || "command"}`, meta: "", body: truncateText((Array.isArray(value?.cmd) ? value?.cmd.join(" ") : asString(value?.label)) || "", 800) };
}

function summarizeExecResult(event: AgUiEvent) {
  const value = asRecord(event.value);
  const exitCode = value?.exitCode;
  const timedOut = value?.timedOut;
  const label = asString(value?.label) || "command";
  return { title: `Finished ${label}`, meta: "", body: `${label} finished with exit=${exitCode}${timedOut ? " (timed out)" : ""}.` };
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
