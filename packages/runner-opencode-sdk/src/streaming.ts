import type { OttoRunnerResult, OttoRunnerRunOptions } from "@otto/ports";

export type JsonRecord = Record<string, unknown>;

export type OpencodeSessionClient = {
  session: {
    create(input?: { body?: Record<string, unknown> }): Promise<unknown>;
    prompt(input: {
      path: { id: string };
      body: Record<string, unknown>;
    }): Promise<unknown>;
  };
};

export type OpencodeEventClient = {
  event: {
    subscribe(input?: { signal?: AbortSignal }): Promise<{ stream: AsyncIterable<unknown> }>;
  };
};

export function isRecord(value: unknown): value is JsonRecord {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

export function asString(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

export function isSessionEventClient(value: unknown): value is OpencodeSessionClient & OpencodeEventClient {
  if (!isRecord(value) || !isRecord(value.session) || !isRecord(value.event)) {
    return false;
  }
  return (
    typeof value.session.create === "function" &&
    typeof value.session.prompt === "function" &&
    typeof value.event.subscribe === "function"
  );
}

export function parseModelId(model: string | undefined):
  | { providerID: string; modelID: string }
  | undefined {
  if (!model) {
    return undefined;
  }
  const slash = model.indexOf("/");
  if (slash === -1) {
    return { providerID: "", modelID: model };
  }
  return {
    providerID: model.slice(0, slash),
    modelID: model.slice(slash + 1),
  };
}

type TextPartState = {
  started: boolean;
  ended: boolean;
  emittedText: string;
};

type ToolPartState = {
  started: boolean;
  ended: boolean;
};

type StreamState = {
  textParts: Map<string, TextPartState>;
  toolParts: Map<string, ToolPartState>;
};

function getPayload(event: unknown): JsonRecord | null {
  if (!isRecord(event)) {
    return null;
  }
  if (isRecord(event.payload)) {
    return event.payload;
  }
  return event;
}

function getSessionIdFromPayload(payload: JsonRecord): string | undefined {
  const properties = isRecord(payload.properties) ? payload.properties : null;
  if (!properties) {
    return undefined;
  }

  const direct = asString(properties.sessionID);
  if (direct) {
    return direct;
  }

  if (isRecord(properties.info)) {
    const infoSession = asString(properties.info.sessionID);
    if (infoSession) {
      return infoSession;
    }
  }

  if (isRecord(properties.part)) {
    const partSession = asString(properties.part.sessionID);
    if (partSession) {
      return partSession;
    }
  }

  return undefined;
}

async function emitTextStart(options: OttoRunnerRunOptions, messageId: string, rawEvent: unknown): Promise<void> {
  await options.onEvent?.({
    type: "TEXT_MESSAGE_START",
    messageId,
    role: "assistant",
    timestamp: Date.now(),
    rawEvent,
  });
}

async function emitTextDelta(options: OttoRunnerRunOptions, messageId: string, delta: string, rawEvent: unknown): Promise<void> {
  if (!delta) {
    return;
  }
  await options.onEvent?.({
    type: "TEXT_MESSAGE_CONTENT",
    messageId,
    delta,
    timestamp: Date.now(),
    rawEvent,
  });
}

async function emitTextEnd(options: OttoRunnerRunOptions, messageId: string, rawEvent: unknown): Promise<void> {
  await options.onEvent?.({
    type: "TEXT_MESSAGE_END",
    messageId,
    timestamp: Date.now(),
    rawEvent,
  });
}

async function emitToolStart(args: {
  options: OttoRunnerRunOptions;
  toolCallId: string;
  toolCallName: string;
  input: unknown;
  rawEvent: unknown;
}): Promise<void> {
  await args.options.onEvent?.({
    type: "TOOL_CALL_START",
    toolCallId: args.toolCallId,
    toolCallName: args.toolCallName,
    timestamp: Date.now(),
    rawEvent: args.rawEvent,
  });
  await args.options.onEvent?.({
    type: "TOOL_CALL_ARGS",
    toolCallId: args.toolCallId,
    delta: JSON.stringify(args.input ?? {}),
    timestamp: Date.now(),
    rawEvent: args.rawEvent,
  });
}

async function emitToolEnd(args: {
  options: OttoRunnerRunOptions;
  toolCallId: string;
  result: string;
  rawEvent: unknown;
}): Promise<void> {
  await args.options.onEvent?.({
    type: "TOOL_CALL_END",
    toolCallId: args.toolCallId,
    timestamp: Date.now(),
    rawEvent: args.rawEvent,
  });
  await args.options.onEvent?.({
    type: "TOOL_CALL_RESULT",
    messageId: `tool-result-${args.toolCallId}`,
    toolCallId: args.toolCallId,
    content: args.result,
    role: "tool",
    timestamp: Date.now(),
    rawEvent: args.rawEvent,
  });
}

async function handleTextPart(args: {
  options: OttoRunnerRunOptions;
  payload: JsonRecord;
  part: JsonRecord;
  properties: JsonRecord;
  partId: string;
  messageId: string;
  state: StreamState;
}): Promise<void> {
  const current = args.state.textParts.get(args.partId) ?? {
    started: false,
    ended: false,
    emittedText: "",
  };
  if (!current.started) {
    current.started = true;
    await emitTextStart(args.options, args.messageId, args.payload);
  }

  const delta = asString(args.properties.delta);
  if (delta) {
    current.emittedText += delta;
    await emitTextDelta(args.options, args.messageId, delta, args.payload);
  } else {
    const fullText = asString(args.part.text) ?? "";
    if (fullText.startsWith(current.emittedText)) {
      const nextDelta = fullText.slice(current.emittedText.length);
      current.emittedText = fullText;
      await emitTextDelta(args.options, args.messageId, nextDelta, args.payload);
    }
  }

  const ended = isRecord(args.part.time) && typeof args.part.time.end === "number";
  if (ended && !current.ended) {
    current.ended = true;
    await emitTextEnd(args.options, args.messageId, args.payload);
  }

  args.state.textParts.set(args.partId, current);
}

async function handleToolPart(args: {
  options: OttoRunnerRunOptions;
  payload: JsonRecord;
  part: JsonRecord;
  partId: string;
  state: StreamState;
}): Promise<void> {
  const current = args.state.toolParts.get(args.partId) ?? { started: false, ended: false };
  const callId = asString(args.part.callID) ?? args.partId;
  const toolName = asString(args.part.tool) ?? "tool";
  const toolState = isRecord(args.part.state) ? args.part.state : null;
  const toolStatus = toolState ? asString(toolState.status) : undefined;

  if (!current.started) {
    current.started = true;
    await emitToolStart({
      options: args.options,
      toolCallId: callId,
      toolCallName: toolName,
      input: toolState?.input,
      rawEvent: args.payload,
    });
  }

  if (!current.ended && (toolStatus === "completed" || toolStatus === "error")) {
    current.ended = true;
    await emitToolEnd({
      options: args.options,
      toolCallId: callId,
      result:
        asString(toolState?.output) ??
        asString(toolState?.error) ??
        JSON.stringify(toolState ?? {}),
      rawEvent: args.payload,
    });
  }

  args.state.toolParts.set(args.partId, current);
}

async function handleReasoningPart(args: {
  options: OttoRunnerRunOptions;
  payload: JsonRecord;
  part: JsonRecord;
}): Promise<void> {
  await args.options.onEvent?.({
    type: "CUSTOM",
    name: "otto.reasoning",
    value: args.part,
    timestamp: Date.now(),
    rawEvent: args.payload,
  });
}

async function handlePartUpdated(args: {
  options: OttoRunnerRunOptions;
  payload: JsonRecord;
  state: StreamState;
}): Promise<void> {
  const properties = isRecord(args.payload.properties) ? args.payload.properties : null;
  const part = properties && isRecord(properties.part) ? properties.part : null;
  if (!properties || !part) {
    return;
  }

  const partId = asString(part.id);
  const partType = asString(part.type);
  const messageId = asString(part.messageID) ?? partId;
  if (!partId || !partType || !messageId) {
    return;
  }

  if (partType === "text") {
    await handleTextPart({
      options: args.options,
      payload: args.payload,
      part,
      properties,
      partId,
      messageId,
      state: args.state,
    });
    return;
  }

  if (partType === "tool") {
    await handleToolPart({
      options: args.options,
      payload: args.payload,
      part,
      partId,
      state: args.state,
    });
    return;
  }

  if (partType === "reasoning") {
    await handleReasoningPart({
      options: args.options,
      payload: args.payload,
      part,
    });
  }
}

async function emitRawEvent(options: OttoRunnerRunOptions, payload: JsonRecord): Promise<void> {
  await options.onLog?.({
    runnerId: "opencode-sdk",
    channel: "raw",
    level: "debug",
    message: JSON.stringify(payload),
    raw: payload,
  });
}

function extractTextFromPromptResponse(value: unknown): string | undefined {
  if (!isRecord(value)) {
    return undefined;
  }
  const parts = Array.isArray(value.parts) ? value.parts : null;
  if (!parts) {
    return undefined;
  }
  const chunks: string[] = [];
  for (const part of parts) {
    if (!isRecord(part) || asString(part.type) !== "text") {
      continue;
    }
    const text = asString(part.text);
    if (text) {
      chunks.push(text);
    }
  }
  return chunks.length > 0 ? chunks.join("\n") : undefined;
}

function extractSessionIdFromPromptResponse(value: unknown): string | undefined {
  if (!isRecord(value)) {
    return undefined;
  }
  if (isRecord(value.info)) {
    const sessionId = asString(value.info.sessionID);
    if (sessionId) {
      return sessionId;
    }
  }
  return undefined;
}

export async function runSessionStreaming(args: {
  client: OpencodeSessionClient & OpencodeEventClient;
  options: OttoRunnerRunOptions;
  model?: string;
  variant?: string;
}): Promise<OttoRunnerResult> {
  const model = parseModelId(args.model);
  const createResult = args.options.sessionId
    ? undefined
    : await args.client.session.create({
        body: { title: `Otto ${args.options.phaseName} ${args.options.role}` },
      });
  const createdSession = isRecord(createResult) && isRecord(createResult.data) ? createResult.data : createResult;
  const sessionId = args.options.sessionId ?? (isRecord(createdSession) ? asString(createdSession.id) : undefined);
  if (!sessionId) {
    return {
      success: false,
      error: "OpenCode SDK session path did not provide a session id.",
      sessionId: args.options.sessionId,
    };
  }

  const abortController = new AbortController();
  const subscription = await args.client.event.subscribe({ signal: abortController.signal });
  const state: StreamState = {
    textParts: new Map(),
    toolParts: new Map(),
  };

  const consume = (async () => {
    for await (const event of subscription.stream) {
      const payload = getPayload(event);
      if (!payload) {
        continue;
      }
      const payloadSessionId = getSessionIdFromPayload(payload);
      if (payloadSessionId && payloadSessionId !== sessionId) {
        continue;
      }
      await emitRawEvent(args.options, payload);
      if (asString(payload.type) === "message.part.updated") {
        await handlePartUpdated({
          options: args.options,
          payload,
          state,
        });
      }
    }
  })();

  const body: Record<string, unknown> = {
    parts: [{ type: "text", text: args.options.prompt }],
  };
  if (model && model.providerID && model.modelID) {
    body.model = model;
  }
  if (args.options.jsonSchema) {
    body.format = {
      type: "json_schema",
      schema: args.options.jsonSchema,
    };
  }
  if (args.variant) {
    body.variant = args.variant;
  }

  const promptPromise = args.client.session.prompt({
    path: { id: sessionId },
    body,
  });

  const wrapped = await new Promise<
    | { kind: "timedOut" }
    | { kind: "response"; value: unknown }
    | { kind: "error"; error: unknown }
  >((resolve) => {
    const timeoutMs = args.options.timeoutMs ?? 10 * 60_000;
    const timer = setTimeout(() => {
      resolve({ kind: "timedOut" });
    }, timeoutMs);
    promptPromise
      .then((value) => {
        clearTimeout(timer);
        resolve({ kind: "response", value });
      })
      .catch((error) => {
        clearTimeout(timer);
        resolve({ kind: "error", error });
      });
  });

  abortController.abort();
  await Promise.race([
    consume,
    new Promise((resolve) => setTimeout(resolve, 50)),
  ]);

  if (wrapped.kind === "timedOut") {
    return {
      success: false,
      sessionId,
      timedOut: true,
      error: "OpenCode SDK request timed out.",
    };
  }

  if (wrapped.kind === "error") {
    const errorMessage = wrapped.error instanceof Error ? wrapped.error.message : String(wrapped.error);
    return {
      success: false,
      sessionId,
      error: errorMessage,
      contextOverflow: /context|token.*limit|too many tokens|prompt too long/i.test(errorMessage),
    };
  }

  const response = isRecord(wrapped.value) && isRecord(wrapped.value.data) ? wrapped.value.data : wrapped.value;
  const outputText = extractTextFromPromptResponse(response);
  const responseSessionId = extractSessionIdFromPromptResponse(response) ?? sessionId;

  if (!outputText) {
    return {
      success: false,
      sessionId: responseSessionId,
      error: "OpenCode SDK session prompt did not return text output.",
    };
  }

  return {
    success: true,
    sessionId: responseSessionId,
    outputText,
  };
}
