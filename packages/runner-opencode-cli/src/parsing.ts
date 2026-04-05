import type { OttoRunnerLog } from "@otto/ports";

type JsonRecord = Record<string, unknown>;

export type ParsedOutput = {
  sessionId?: string;
  finalText?: string;
  finalError?: string;
  lastText?: string;
  sawFinalRecord: boolean;
  streamTextParts: string[];
  nonJsonLines: string[];
  logs: OttoRunnerLog[];
};

export type ParsedLineAnalysis = {
  raw?: unknown;
  text?: string;
  isTextPayload: boolean;
  isFinalPayload: boolean;
};

function isRecord(value: unknown): value is JsonRecord {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function asString(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function parseJsonLine(line: string): JsonRecord | null {
  try {
    const parsed = JSON.parse(line) as unknown;
    return isRecord(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function extractPayloadType(obj: JsonRecord): string | undefined {
  const raw = asString(obj.type) ?? asString(obj.event) ?? asString(obj.kind);
  if (!raw) {
    return undefined;
  }
  return raw.toLowerCase().replace(/-/g, "_");
}

function extractPartType(obj: JsonRecord): string | undefined {
  if (!isRecord(obj.part)) {
    return undefined;
  }
  const raw = asString(obj.part.type);
  if (!raw) {
    return undefined;
  }
  return raw.toLowerCase().replace(/-/g, "_");
}

function extractSessionId(obj: JsonRecord): string | undefined {
  const direct =
    asString(obj.session_id) ??
    asString(obj.sessionID) ??
    asString(obj.sessionId) ??
    asString(obj.session);
  if (direct) {
    return direct;
  }

  if (isRecord(obj.part)) {
    const partSession = asString(obj.part.sessionID) ?? asString(obj.part.sessionId);
    if (partSession) {
      return partSession;
    }
  }

  if (isRecord(obj.session)) {
    const nestedSession = asString(obj.session.id);
    if (nestedSession) {
      return nestedSession;
    }
  }

  return undefined;
}

function extractTextFromContent(value: unknown): string | undefined {
  if (typeof value === "string") {
    return value;
  }

  if (Array.isArray(value)) {
    const parts: string[] = [];
    for (const item of value) {
      if (typeof item === "string") {
        parts.push(item);
        continue;
      }
      if (!isRecord(item)) {
        continue;
      }
      const text = asString(item.text) ?? asString(item.content) ?? asString(item.value);
      if (text) {
        parts.push(text);
      }
    }
    return parts.length > 0 ? parts.join("\n") : undefined;
  }

  if (!isRecord(value)) {
    return undefined;
  }

  return (
    asString(value.text) ??
    asString(value.content) ??
    asString(value.value) ??
    extractTextFromContent(value.content)
  );
}

function extractTextCandidate(obj: JsonRecord): string | undefined {
  const direct =
    asString(obj.result) ??
    asString(obj.output_text) ??
    asString(obj.text) ??
    asString(obj.content);
  if (direct) {
    return direct;
  }

  if (isRecord(obj.message)) {
    const messageText = asString(obj.message.text) ?? extractTextFromContent(obj.message.content);
    if (messageText) {
      return messageText;
    }
  }

  if (isRecord(obj.item)) {
    const itemText = asString(obj.item.text) ?? extractTextFromContent(obj.item.content);
    if (itemText) {
      return itemText;
    }
  }

  if (isRecord(obj.part)) {
    const partText = asString(obj.part.text) ?? extractTextFromContent(obj.part.content);
    if (partText) {
      return partText;
    }
  }

  return extractTextFromContent(obj.content);
}

function isFinalRecord(obj: JsonRecord): boolean {
  const payloadType = extractPayloadType(obj);
  const partType = extractPartType(obj);
  return (
    payloadType === "result" ||
    payloadType === "final" ||
    payloadType === "step_finish" ||
    partType === "step_finish" ||
    obj.final === true
  );
}

function extractErrorMessage(obj: JsonRecord): string | undefined {
  if (typeof obj.error === "string") {
    return obj.error;
  }
  if (isRecord(obj.error)) {
    const nested = asString(obj.error.message);
    if (nested) {
      return nested;
    }
  }
  if (extractPayloadType(obj) === "error") {
    const message = asString(obj.message);
    if (message) {
      return message;
    }
  }
  return undefined;
}

function extractFinalError(obj: JsonRecord, textCandidate?: string): string | undefined {
  const payloadType = extractPayloadType(obj);
  const hasErrorSignal = obj.is_error === true || payloadType === "error" || Boolean(obj.error);

  if (!hasErrorSignal) {
    return undefined;
  }

  if (typeof textCandidate === "string" && textCandidate.trim()) {
    return textCandidate;
  }

  const message = extractErrorMessage(obj);
  if (message) {
    return message;
  }

  return "OpenCode CLI returned an error result.";
}

function applyJsonRecord(parsed: ParsedOutput, obj: JsonRecord): void {
  const payloadType = extractPayloadType(obj);
  const partType = extractPartType(obj);
  const isTextPayload = payloadType === "text" || partType === "text";
  const isFinalPayload = isFinalRecord(obj);

  const sid = extractSessionId(obj);
  if (sid) {
    parsed.sessionId = sid;
  }

  const textCandidate = extractTextCandidate(obj);
  if (textCandidate) {
    parsed.lastText = textCandidate;
    if (isTextPayload) {
      parsed.streamTextParts.push(textCandidate);
      parsed.logs.push({
        runnerId: "opencode-cli",
        channel: "agent_message",
        level: "info",
        message: textCandidate,
        raw: obj,
      });
    }
  }

  const maybeError = extractFinalError(obj, textCandidate);
  if (maybeError && isFinalPayload) {
    parsed.finalError = maybeError;
  }

  if (isFinalPayload && textCandidate) {
    parsed.finalText = textCandidate;
  }
}

export function parseStreamJson(stdout: string): ParsedOutput {
  const parsed: ParsedOutput = {
    sawFinalRecord: false,
    streamTextParts: [],
    nonJsonLines: [],
    logs: [],
  };

  for (const line of stdout.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed) {
      continue;
    }

    const obj = parseJsonLine(trimmed);
    if (!obj) {
      parsed.lastText = trimmed;
      parsed.nonJsonLines.push(trimmed);
      parsed.logs.push({
        runnerId: "opencode-cli",
        channel: "raw",
        level: "debug",
        message: trimmed,
        raw: trimmed,
      });
      continue;
    }

    parsed.logs.push({
      runnerId: "opencode-cli",
      channel: "raw",
      level: "debug",
      message: trimmed,
      raw: obj,
    });

    if (isFinalRecord(obj)) {
      parsed.sawFinalRecord = true;
    }

    applyJsonRecord(parsed, obj);
  }

  if (!parsed.finalText && parsed.streamTextParts.length > 0) {
    const joined = parsed.streamTextParts.join("").trim();
    if (joined.length > 0) {
      parsed.finalText = joined;
    }
  }

  return parsed;
}

export function analyzeLine(line: string): ParsedLineAnalysis | null {
  const trimmed = line.trim();
  if (!trimmed) {
    return null;
  }

  const obj = parseJsonLine(trimmed);
  if (!obj) {
    return {
      raw: trimmed,
      isTextPayload: false,
      isFinalPayload: false,
    };
  }

  const payloadType = extractPayloadType(obj);
  const partType = extractPartType(obj);
  return {
    raw: obj,
    text: extractTextCandidate(obj),
    isTextPayload: payloadType === "text" || partType === "text",
    isFinalPayload: isFinalRecord(obj),
  };
}
