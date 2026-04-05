import type {
  OttoRole,
  OttoRunner,
  OttoRunnerResult,
  OttoRunnerRunOptions,
} from "@otto/ports";

type CodexModelConfig = {
  model?: string;
  apiKeyEnvVar?: string;
};

type CodexClientFactoryArgs = {
  apiKey?: string;
};

type CodexResponsesApi = {
  create(input: Record<string, unknown>): Promise<unknown>;
};

type CodexResponseStream = AsyncIterable<unknown> & {
  controller?: {
    abort(): void;
  };
};

type CodexSdkClient = {
  responses: CodexResponsesApi;
};

type CodexClientFactory = (
  args: CodexClientFactoryArgs,
) => CodexSdkClient | Promise<CodexSdkClient>;

export type CodexSdkRunnerOptions = {
  default?: CodexModelConfig;
  byRole?: Partial<Record<OttoRole, CodexModelConfig>>;
  apiKeyEnvVar?: string;
  client?: CodexSdkClient;
  clientFactory?: CodexClientFactory;
};

const DEFAULT_API_KEY_ENV = "OPENAI_API_KEY";
const CONTEXT_OVERFLOW_PATTERN =
  /prompt is too long|context length|context window|maximum context|token.*limit/i;

const DEFAULT_BY_ROLE: Record<OttoRole, CodexModelConfig> = {
  projectLead: { model: "gpt-5-codex" },
  lead: { model: "gpt-5-codex" },
  task: { model: "gpt-5-codex" },
  reviewer: { model: "gpt-5-codex" },
  summarize: { model: "gpt-5-mini" },
};

type JsonRecord = Record<string, unknown>;

type TimeoutResult<T> =
  | { timedOut: true }
  | { timedOut: false; value: T };

type OpenAiConstructor = new (options?: {
  apiKey?: string;
}) => CodexSdkClient;

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

function getErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  if (typeof error === "string") {
    return error;
  }
  if (isRecord(error)) {
    const message = asString(error.message);
    if (message) {
      return message;
    }
  }
  return "Unknown Codex SDK error.";
}

function mergeConfig(role: OttoRole, options: CodexSdkRunnerOptions): CodexModelConfig {
  return {
    ...DEFAULT_BY_ROLE[role],
    ...(options.default ?? {}),
    ...(options.byRole?.[role] ?? {}),
  };
}

function extractTextFromOutputContent(outputItem: unknown): string | undefined {
  if (!isRecord(outputItem)) {
    return undefined;
  }

  if (Array.isArray(outputItem.content)) {
    const parts: string[] = [];
    for (const part of outputItem.content) {
      if (!isRecord(part)) {
        continue;
      }
      const text = asString(part.text) ?? asString(part.content) ?? asString(part.output_text);
      if (text) {
        parts.push(text);
      }
    }
    if (parts.length > 0) {
      return parts.join("\n");
    }
  }

  return asString(outputItem.text) ?? asString(outputItem.output_text);
}

function extractTextFromResponse(response: unknown): string | undefined {
  if (!isRecord(response)) {
    return undefined;
  }

  const direct = asString(response.output_text) ?? asString(response.text);
  if (direct) {
    return direct;
  }

  if (!Array.isArray(response.output)) {
    return undefined;
  }

  const chunks: string[] = [];
  for (const item of response.output) {
    const text = extractTextFromOutputContent(item);
    if (text) {
      chunks.push(text);
    }
  }

  return chunks.length > 0 ? chunks.join("\n") : undefined;
}

function extractSessionId(response: unknown): string | undefined {
  if (!isRecord(response)) {
    return undefined;
  }
  return asString(response.id) ?? asString(response.session_id) ?? asString(response.sessionId);
}

function resolveOpenAiConstructor(mod: unknown): OpenAiConstructor | null {
  if (typeof mod === "function") {
    return mod as OpenAiConstructor;
  }

  if (!isRecord(mod)) {
    return null;
  }

  const direct = [mod.OpenAI, mod.default];
  for (const value of direct) {
    if (typeof value === "function") {
      return value as OpenAiConstructor;
    }
  }

  if (isRecord(mod.default) && typeof mod.default.OpenAI === "function") {
    return mod.default.OpenAI as OpenAiConstructor;
  }

  return null;
}

async function createDefaultClient(args: CodexClientFactoryArgs): Promise<CodexSdkClient> {
  try {
    const moduleId = "openai";
    const mod = await import(moduleId);
    const Ctor = resolveOpenAiConstructor(mod);
    if (!Ctor) {
      throw new Error("OpenAI constructor not found in module exports.");
    }
    return new Ctor(args.apiKey ? { apiKey: args.apiKey } : undefined);
  } catch (error) {
    throw new Error(
      `OpenAI SDK unavailable: ${getErrorMessage(error)}. Install openai and set OPENAI_API_KEY.`,
    );
  }
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<TimeoutResult<T>> {
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    return { timedOut: false, value: await promise };
  }

  return new Promise<TimeoutResult<T>>((resolve, reject) => {
    const timer = setTimeout(() => {
      resolve({ timedOut: true });
    }, timeoutMs);

    promise
      .then((value) => {
        clearTimeout(timer);
        resolve({ timedOut: false, value });
      })
      .catch((error) => {
        clearTimeout(timer);
        reject(error);
      });
  });
}

async function emitAssistantText(args: {
  onEvent: OttoRunnerRunOptions["onEvent"];
  messageId: string;
  text: string;
  rawEvent?: unknown;
}): Promise<void> {
  if (!args.onEvent || !args.text.trim()) {
    return;
  }
  const timestamp = Date.now();
  await args.onEvent({ type: "TEXT_MESSAGE_START", messageId: args.messageId, role: "assistant", timestamp, rawEvent: args.rawEvent });
  await args.onEvent({ type: "TEXT_MESSAGE_CONTENT", messageId: args.messageId, delta: args.text, timestamp, rawEvent: args.rawEvent });
  await args.onEvent({ type: "TEXT_MESSAGE_END", messageId: args.messageId, timestamp, rawEvent: args.rawEvent });
}

async function emitAssistantTextStart(args: {
  onEvent: OttoRunnerRunOptions["onEvent"];
  messageId: string;
  rawEvent?: unknown;
}): Promise<void> {
  if (!args.onEvent) {
    return;
  }
  await args.onEvent({
    type: "TEXT_MESSAGE_START",
    messageId: args.messageId,
    role: "assistant",
    timestamp: Date.now(),
    rawEvent: args.rawEvent,
  });
}

async function emitAssistantTextDelta(args: {
  onEvent: OttoRunnerRunOptions["onEvent"];
  messageId: string;
  delta: string;
  rawEvent?: unknown;
}): Promise<void> {
  if (!args.onEvent || !args.delta.length) {
    return;
  }
  await args.onEvent({
    type: "TEXT_MESSAGE_CONTENT",
    messageId: args.messageId,
    delta: args.delta,
    timestamp: Date.now(),
    rawEvent: args.rawEvent,
  });
}

async function emitAssistantTextEnd(args: {
  onEvent: OttoRunnerRunOptions["onEvent"];
  messageId: string;
  rawEvent?: unknown;
}): Promise<void> {
  if (!args.onEvent) {
    return;
  }
  await args.onEvent({
    type: "TEXT_MESSAGE_END",
    messageId: args.messageId,
    timestamp: Date.now(),
    rawEvent: args.rawEvent,
  });
}

function isAsyncIterable(value: unknown): value is AsyncIterable<unknown> {
  return Boolean(value) && typeof (value as AsyncIterable<unknown>)[Symbol.asyncIterator] === "function";
}

async function runStreamingResponse(args: {
  stream: CodexResponseStream;
  options: OttoRunnerRunOptions;
}): Promise<{ response: unknown; streamedText: string; timedOut: boolean }> {
  const messageId = "codex-sdk-message-1";
  let streamedText = "";
  let started = false;

  const consume = (async () => {
    for await (const event of args.stream) {
      await args.options.onLog?.({
        runnerId: "codex-sdk",
        channel: "raw",
        level: "debug",
        message: JSON.stringify(event),
        raw: event,
      });

      if (!isRecord(event)) {
        continue;
      }
      const eventType = asString(event.type);
      if (eventType === "response.output_text.delta") {
        const delta = typeof event.delta === "string" ? event.delta : undefined;
        if (!delta) continue;
        if (!started) {
          started = true;
          await emitAssistantTextStart({
            onEvent: args.options.onEvent,
            messageId,
            rawEvent: event,
          });
        }
        streamedText += delta;
        await emitAssistantTextDelta({
          onEvent: args.options.onEvent,
          messageId,
          delta,
          rawEvent: event,
        });
      }
    }
    return undefined;
  })();

  const wrapped = await withTimeout(consume, args.options.timeoutMs ?? 10 * 60_000);
  if (wrapped.timedOut) {
    args.stream.controller?.abort();
    return { response: undefined, streamedText, timedOut: true };
  }

  if (started) {
    await emitAssistantTextEnd({
      onEvent: args.options.onEvent,
      messageId,
    });
  }

  return { response: undefined, streamedText, timedOut: false };
}

class CodexSdkRunner implements OttoRunner {
  readonly kind = "codex-sdk";
  readonly id = "codex-sdk";

  constructor(private readonly options: CodexSdkRunnerOptions = {}) {}

  async run(options: OttoRunnerRunOptions): Promise<OttoRunnerResult> {
    const cfg = mergeConfig(options.role, this.options);
    const apiKeyEnv = cfg.apiKeyEnvVar ?? this.options.apiKeyEnvVar ?? DEFAULT_API_KEY_ENV;

    let client: CodexSdkClient;
    try {
      if (this.options.client) {
        client = this.options.client;
      } else {
        const factory = this.options.clientFactory ?? createDefaultClient;
        client = await factory({ apiKey: process.env[apiKeyEnv] });
      }
    } catch (error) {
      const message = getErrorMessage(error);
      return {
        success: false,
        sessionId: options.sessionId,
        error: message,
        contextOverflow: CONTEXT_OVERFLOW_PATTERN.test(message),
      };
    }

    const request: Record<string, unknown> = {
      model: cfg.model,
      input: options.prompt,
    };

    if (options.jsonSchema) {
      request.text = {
        format: {
          type: "json_schema",
          name: "otto_output",
          schema: options.jsonSchema,
        },
      };
    }

    let response: unknown;
    let streamedText = "";
    try {
      const first = await withTimeout(
        client.responses.create({ ...request, stream: true }),
        options.timeoutMs ?? 10 * 60_000,
      );
      if (first.timedOut) {
        return {
          success: false,
          sessionId: options.sessionId,
          timedOut: true,
          error: "Codex SDK request timed out.",
        };
      }

      if (isAsyncIterable(first.value)) {
        const streamed = await runStreamingResponse({
          stream: first.value as CodexResponseStream,
          options,
        });
        streamedText = streamed.streamedText;
        if (streamed.timedOut) {
          return {
            success: false,
            sessionId: options.sessionId,
            timedOut: true,
            error: "Codex SDK request timed out.",
          };
        }
      } else {
        response = first.value;
      }
    } catch (error) {
      const message = getErrorMessage(error);
      return {
        success: false,
        sessionId: options.sessionId,
        error: message,
        contextOverflow: CONTEXT_OVERFLOW_PATTERN.test(message),
      };
    }

    const outputText = streamedText || extractTextFromResponse(response);
    const sessionId = extractSessionId(response) ?? options.sessionId;

    if (!outputText) {
      return {
        success: false,
        sessionId,
        error: "Codex SDK did not return text output.",
      };
    }

    if (!streamedText) {
      await emitAssistantText({
        onEvent: options.onEvent,
        messageId: `${this.id}-message-1`,
        text: outputText,
        rawEvent: response,
      });
    }

    return {
      success: true,
      sessionId,
      outputText,
      contextOverflow: CONTEXT_OVERFLOW_PATTERN.test(outputText),
    };
  }
}

export function createCodexSdkRunner(options: CodexSdkRunnerOptions = {}): OttoRunner {
  return new CodexSdkRunner(options);
}
