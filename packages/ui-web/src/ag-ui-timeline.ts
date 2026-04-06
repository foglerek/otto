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

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}

function capitalizeSentence(value: string): string {
  return value ? `${value[0]?.toUpperCase() || ""}${value.slice(1)}` : value;
}

function cleanHeadlineText(value: string): string {
  let cleaned = value
    .replace(/<[^>]+>/g, " ")
    .replace(/[`*_#]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  const preferredClause = cleaned.match(/(?:^|[.!?]\s+)(?:next|now|then)\s+i(?:['’]?m| am|['’]?ll| will)\s+(.+)$/i)?.[1]
    || cleaned.match(/(?:^|[.!?]\s+)let me\s+(.+)$/i)?.[1]
    || cleaned.match(/^i(?:['’]?m| am|['’]?ll| will)\s+(.+)$/i)?.[1];
  if (preferredClause) {
    cleaned = preferredClause.trim();
  }

  cleaned = cleaned
    .replace(/^(?:next|now|then)\s+/i, "")
    .replace(/^i(?:['’]?m| am|['’]?ll| will)\s+/i, "")
    .replace(/^let me\s+/i, "")
    .replace(/^good\s+[—-]?\s*/i, "")
    .replace(/^the plan now\s+/i, "plan now ")
    .replace(/[:;,-]\s*$/, "")
    .trim();

  return capitalizeSentence(cleaned);
}

function extractPreferredActionHeadline(value: string): { title: string; matchedText: string } | undefined {
  const match = value.match(/(?:^|[.!?]\s+)(?:next|now|then)\s+i(?:['’]?m| am|['’]?ll| will)\s+(.+)$/i)
    || value.match(/(?:^|[.!?]\s+)let me\s+(.+)$/i)
    || value.match(/^i(?:['’]?m| am|['’]?ll| will)\s+(.+)$/i);
  if (!match?.[1]) {
    return undefined;
  }
  return {
    title: cleanHeadlineText(match[1]),
    matchedText: match[0].trim(),
  };
}

function splitNarrativeBody(body: string): { title?: string; body: string } {
  const trimmed = body.trim();
  if (!trimmed) {
    return { body: "" };
  }

  const nonEmptyLines = trimmed
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  const firstLine = nonEmptyLines[0] || "";
  const firstSentence = trimmed.match(/^[^\n.!?]+[.!?]?/u)?.[0]?.trim() || firstLine;
  const preferredActionHeadline = extractPreferredActionHeadline(trimmed);
  const headlineSource = firstLine.includes(". ") || firstLine.includes("! ") || firstLine.includes("? ")
    ? firstSentence
    : (firstLine.length <= 140 ? firstLine : firstSentence);
  const candidate = preferredActionHeadline?.title || cleanHeadlineText(headlineSource);

  if (!candidate) {
    return { body: trimmed };
  }

  const normalizedBody = trimmed.replace(/^\s*<OK>\s*/i, "").trim();
  const normalizedCandidate = candidate.replace(/[.!?]+$/, "").trim().toLowerCase();
  const withoutTitle = preferredActionHeadline
    ? normalizedBody.replace(preferredActionHeadline.matchedText, "").replace(/^[:.!?\s-]+/, "").trim()
    : normalizedBody
      .replace(new RegExp(`^${candidate.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}[:.!?\\s]*`, "i"), "")
      .trim();

  if (!withoutTitle || withoutTitle.toLowerCase() === normalizedCandidate) {
    return { title: candidate, body: "" };
  }

  return { title: candidate, body: withoutTitle };
}

function extractModelLabel(event: AgUiEvent): string {
  const rawEvent = asRecord(event.rawEvent);
  const message = asRecord(rawEvent?.message);
  const item = asRecord(rawEvent?.item);
  return asString(message?.model) || asString(item?.model) || "";
}

export type AgUiTimelineItem = {
  kind: "message" | "tool" | "reasoning" | "control" | "event";
  title: string;
  meta: string;
  body: string;
  timestamp?: number;
  status?: "running" | "done" | "attention" | "neutral";
  icon?: "otto" | "claude" | "codex";
};

function classifySourceIcon(event: AgUiEvent): AgUiTimelineItem["icon"] {
  const rawEvent = asRecord(event.rawEvent);
  const message = asRecord(rawEvent?.message);
  const item = asRecord(rawEvent?.item);
  const signals = [
    event.messageId,
    event.toolCallName,
    event.source,
    extractModelLabel(event),
    asString(message?.type),
    asString(item?.type),
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();

  if (signals.includes("claude")) {
    return "claude";
  }
  if (signals.includes("codex") || signals.includes("gpt-")) {
    return "codex";
  }
  return "otto";
}

function hiddenInPrimaryFeed(event: AgUiEvent): boolean {
  return event.type === "RAW"
    || event.type === "STEP_STARTED"
    || event.type === "STEP_FINISHED"
    || isLowSignalToolEvent(event)
    || (event.type === "CUSTOM" && ["otto.exec_start", "otto.exec_result", "otto.run_finished", "otto.phase_entered"].includes(event.name || ""))
    || (event.type === "CUSTOM" && event.name === "otto.control_plane" && !hasOutstandingPrompts(event));
}

function isNarrativeFallbackEvent(event: AgUiEvent): boolean {
  if (event.type === "RUN_STARTED" || event.type === "RUN_FINISHED" || event.type === "RUN_ERROR") {
    return true;
  }
  if (event.type === "CUSTOM" && ["otto.phase_entered", "otto.task_decision_recorded"].includes(event.name || "")) {
    return true;
  }
  if (event.type === "CUSTOM" && event.name === "otto.control_plane" && hasOutstandingPrompts(event)) {
    return true;
  }
  return event.type.startsWith("TEXT_MESSAGE");
}

export function splitAgUiEvents(events: AgUiEvent[]): { primary: AgUiEvent[]; debug: AgUiEvent[] } {
  const primary = events.filter((event) => !hiddenInPrimaryFeed(event));
  const debug = events.filter((event) => hiddenInPrimaryFeed(event));
  if (primary.length > 0) {
    return { primary, debug };
  }

  const fallbackPrimary = events.filter(isNarrativeFallbackEvent);

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
    meta: extractModelLabel(event),
    body: "",
    timestamp: event.timestamp,
    status: "done" as const,
    icon: classifySourceIcon(event),
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
    const narrative = splitNarrativeBody(body);
    return {
      ...item,
      title: narrative.title || item.title,
      body: narrative.body,
      meta: item.meta || "Otto",
    };
  });
}

function isNoiseNarrativeItem(item: AgUiTimelineItem): boolean {
  const compact = `${item.title} ${item.body}`.replace(/\s+/g, " ").trim();
  return /^<DECISION>[^<]+<\/DECISION>$/i.test(compact)
    || /^<OK>$/i.test(compact)
    || /^OK$/i.test(compact)
    || (item.title === "Otto" && /^<OK>$/i.test(item.body.trim()));
}

function isDecisionOnlyNarrativeItem(item: AgUiTimelineItem): boolean {
  const compact = `${item.title} ${item.body}`.replace(/\s+/g, " ").trim().toLowerCase();
  return compact === "acceptance" || compact === "remediation" || compact === "failed";
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
      icon: classifySourceIcon(event),
    });
  }

  return finalizeMessageItems(items).filter(
    (item) => (item.body || item.kind !== "message" || item.title) && !isNoiseNarrativeItem(item) && !isDecisionOnlyNarrativeItem(item),
  );
}
