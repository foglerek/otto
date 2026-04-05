import { summarizeAgUiEvent } from "./ag-ui-summary.js";
import type { AgUiEvent } from "./types.js";

function humanizeToolName(value: string | undefined): string {
  if (!value) return "tool";
  return value.replace(/[-_]+/g, " ");
}

export type AgUiTimelineItem = {
  kind: "message" | "tool" | "reasoning" | "control" | "event";
  title: string;
  meta: string;
  body: string;
  timestamp?: number;
  status?: "running" | "done" | "attention" | "neutral";
};

function hiddenInPrimaryFeed(event: AgUiEvent): boolean {
  return event.type === "RAW" || event.type === "STEP_STARTED" || event.type === "STEP_FINISHED" || (event.type === "CUSTOM" && ["otto.exec_start", "otto.exec_result", "otto.run_finished"].includes(event.name || ""));
}

export function splitAgUiEvents(events: AgUiEvent[]): { primary: AgUiEvent[]; debug: AgUiEvent[] } {
  return {
    primary: events.filter((event) => !hiddenInPrimaryFeed(event)),
    debug: events.filter((event) => hiddenInPrimaryFeed(event)),
  };
}

function consumeMessageEvent(items: AgUiTimelineItem[], byMessageId: Map<string, AgUiTimelineItem>, event: AgUiEvent): boolean {
  if (!event.type.startsWith("TEXT_MESSAGE")) {
    return false;
  }
  const id = event.messageId || `message-${items.length}`;
  const existing = byMessageId.get(id) ?? {
    kind: "message" as const,
    title: "Otto",
    meta: "",
    body: "",
    timestamp: event.timestamp,
    status: "done" as const,
  };
  if (event.type === "TEXT_MESSAGE_CONTENT") {
    existing.body += `${event.delta || ""}`;
  }
  if (!byMessageId.has(id)) {
    byMessageId.set(id, existing);
    items.push(existing);
  }
  return true;
}

function consumeToolEvent(items: AgUiTimelineItem[], byToolId: Map<string, AgUiTimelineItem>, event: AgUiEvent): boolean {
  if (!event.type.startsWith("TOOL_CALL")) {
    return false;
  }
  const id = event.toolCallId || `tool-${items.length}`;
  const existing = byToolId.get(id) ?? {
    kind: "tool" as const,
    title: `Used ${humanizeToolName(event.toolCallName)}`,
    meta: "",
    body: "",
    timestamp: event.timestamp,
    status: "running" as const,
  };
  if (event.type === "TOOL_CALL_ARGS") {
    existing.body = existing.body ? `${existing.body}\n\nInput:\n${event.delta || ""}` : `Input:\n${event.delta || ""}`;
  }
  if (event.type === "TOOL_CALL_RESULT") {
    existing.body = existing.body ? `${existing.body}\n\nResult:\n${event.content || ""}` : `Result:\n${event.content || ""}`;
    existing.status = "done";
  }
  if (event.type === "TOOL_CALL_END") {
    existing.status = "done";
  }
  if (!byToolId.has(id)) {
    byToolId.set(id, existing);
    items.push(existing);
  }
  return true;
}

function classifyNonGroupedEvent(event: AgUiEvent): AgUiTimelineItem["kind"] {
  if (event.type === "CUSTOM" && event.name === "otto.reasoning") return "reasoning";
  if (event.type === "CUSTOM" && event.name === "otto.control_plane") return "control";
  return "event";
}

function classifyStatus(event: AgUiEvent): AgUiTimelineItem["status"] {
  if (event.type === "RUN_ERROR") return "attention";
  if (event.type === "CUSTOM" && event.name === "otto.control_plane") return "attention";
  if (event.type === "CUSTOM" && event.name === "otto.reasoning") return "running";
  if (event.type === "RUN_FINISHED") return "done";
  if (event.type === "RUN_STARTED") return "running";
  return "neutral";
}

export function buildAgUiTimeline(runId: string, events: AgUiEvent[]): AgUiTimelineItem[] {
  const items: AgUiTimelineItem[] = [];
  const byMessageId = new Map<string, AgUiTimelineItem>();
  const byToolId = new Map<string, AgUiTimelineItem>();

  for (const event of events) {
    if (consumeMessageEvent(items, byMessageId, event)) {
      continue;
    }

    if (consumeToolEvent(items, byToolId, event)) {
      continue;
    }

    const summary = summarizeAgUiEvent(runId, event);
    items.push({
      kind: classifyNonGroupedEvent(event),
      title: summary.title,
      meta: summary.meta,
      body: summary.body,
      timestamp: event.timestamp,
      status: classifyStatus(event),
    });
  }

  return items.filter((item) => item.body || item.kind !== "message");
}
