import { summarizeAgUiEvent } from "./ag-ui-summary.js";
import type { AgUiEvent } from "./types.js";

function humanizeToolName(value: string | undefined): string {
  if (!value) return "tool";
  return value.replace(/[-_]+/g, " ");
}

function isLowSignalToolEvent(event: AgUiEvent): boolean {
  if (!event.type.startsWith("TOOL_CALL")) {
    return false;
  }
  return true;
}

function hasOutstandingPrompts(event: AgUiEvent): boolean {
  return Array.isArray(event.value?.prompts) && event.value.prompts.length > 0;
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
  return event.type === "RAW"
    || event.type === "STEP_STARTED"
    || event.type === "STEP_FINISHED"
    || isLowSignalToolEvent(event)
    || (event.type === "CUSTOM" && ["otto.exec_start", "otto.exec_result", "otto.run_finished", "otto.phase_entered"].includes(event.name || ""))
    || (event.type === "CUSTOM" && event.name === "otto.control_plane" && !hasOutstandingPrompts(event));
}

export function splitAgUiEvents(events: AgUiEvent[]): { primary: AgUiEvent[]; debug: AgUiEvent[] } {
  const primary = events.filter((event) => !hiddenInPrimaryFeed(event));
  const debug = events.filter((event) => hiddenInPrimaryFeed(event));
  if (primary.length > 0) {
    return { primary, debug };
  }

  const fallbackPrimary = events.filter((event) => {
    if (event.type === "RUN_STARTED" || event.type === "RUN_FINISHED" || event.type === "RUN_ERROR") {
      return true;
    }
    if (event.type === "CUSTOM" && (event.name === "otto.phase_entered" || (event.name === "otto.control_plane" && hasOutstandingPrompts(event)))) {
      return true;
    }
    return event.type.startsWith("TEXT_MESSAGE");
  });

  return {
    primary: fallbackPrimary,
    debug: debug.filter((event) => !fallbackPrimary.includes(event)),
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

function finalizeMessageItems(items: AgUiTimelineItem[]): AgUiTimelineItem[] {
  return items.map((item) => {
    if (item.kind !== "message") {
      return item;
    }
    const body = item.body.trim();
    if (!body) {
      return item;
    }
    const compact = body.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
    if (compact.length <= 160 && !body.includes("\n")) {
      return {
        ...item,
        title: compact,
        body: "",
        meta: item.meta || "Otto",
      };
    }
    return {
      ...item,
      meta: item.meta || "Otto",
    };
  });
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

  return finalizeMessageItems(items).filter((item) => item.body || item.kind !== "message" || item.title);
}
