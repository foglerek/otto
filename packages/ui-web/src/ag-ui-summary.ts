import { truncateText } from "./helpers.js";
import type { AgUiEvent } from "./types.js";

function summarizeRunEvent(runId: string, event: AgUiEvent) {
  if (event.type === "RUN_STARTED") return { title: "Run started", meta: event.runId || runId, body: `Run started for ${event.runId || runId}.` };
  if (event.type === "RUN_FINISHED") return { title: "Run finished", meta: "", body: truncateText(JSON.stringify(event.result || {}, null, 2), 1200) };
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
  if (event.type === "CUSTOM" && event.name === "otto.reasoning") return { title: "Reasoning", meta: "", body: truncateText(JSON.stringify(event.value || {}, null, 2), 1200) };
  if (event.type === "CUSTOM" && event.name === "otto.control_plane") {
    const jobs = Array.isArray(event.value?.jobs) ? event.value.jobs.length : 0;
    const prompts = Array.isArray(event.value?.prompts) ? event.value.prompts.length : 0;
    return { title: "Control plane", meta: `jobs ${jobs} / prompts ${prompts}`, body: truncateText(JSON.stringify(event.value || {}, null, 2), 1200) };
  }
  return null;
}

export function summarizeAgUiEvent(runId: string, event: AgUiEvent): { title: string; meta: string; body: string } {
  return (
    summarizeRunEvent(runId, event) ??
    summarizeMessageEvent(event) ??
    summarizeToolEvent(event) ??
    summarizeCustomEvent(event) ??
    (event.type === "RAW"
      ? { title: "Raw runner event", meta: event.source || "", body: truncateText(JSON.stringify(event.event || event.rawEvent || {}, null, 2), 1200) }
      : { title: event.type || "Event", meta: event.name || event.source || "", body: truncateText(JSON.stringify(event, null, 2), 1200) })
  );
}
