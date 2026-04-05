import type {
  OttoRole,
  OttoRunner,
  OttoRunnerResult,
  OttoRunnerRunOptions,
} from "@otto/ports";

type OpencodeModelConfig = {
  model?: string;
  variant?: string;
  apiKeyEnvVar?: string;
};

type OpencodeClientFactoryArgs = {
  apiKey?: string;
};

type OpencodeRequest = Record<string, unknown>;

type OpencodeRunClient = {
  run(input: OpencodeRequest): Promise<unknown>;
};

type OpencodeResponsesClient = {
  responses: {
    create(input: OpencodeRequest): Promise<unknown>;
  };
};

type OpencodeSdkClient = OpencodeRunClient | OpencodeResponsesClient;

type OpencodeClientFactory = (
  args: OpencodeClientFactoryArgs,
) => OpencodeSdkClient | Promise<OpencodeSdkClient>;

export type OpencodeSdkRunnerOptions = {
  default?: OpencodeModelConfig;
  byRole?: Partial<Record<OttoRole, OpencodeModelConfig>>;
  apiKeyEnvVar?: string;
  client?: OpencodeSdkClient;
  clientFactory?: OpencodeClientFactory;
};

const DEFAULT_API_KEY_ENV = "OPENCODE_API_KEY";
const CONTEXT_OVERFLOW_PATTERN =
  /context|prompt.*too.*long|token.*limit|maximum context|too many tokens/i;

const DEFAULT_BY_ROLE: Record<OttoRole, OpencodeModelConfig> = {
  projectLead: { model: "openai/gpt-5.3-codex", variant: "xhigh" },
  lead: { model: "openai/gpt-5.3-codex", variant: "xhigh" },
  task: { model: "openai/gpt-5.3-codex" },
  reviewer: { model: "openai/gpt-5.3-codex", variant: "high" },
  summarize: { model: "openai/gpt-5.3-codex", variant: "high" },
};

type JsonRecord = Record<string, unknown>;

type TimeoutResult<T> =
  | { timedOut: true }
  | { timedOut: false; value: T };

type OpencodeSdkConstructor = new (options?: {
  apiKey?: string;
}) => OpencodeSdkClient;

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
  return "Unknown OpenCode SDK error.";
}

function mergeConfig(role: OttoRole, options: OpencodeSdkRunnerOptions): OpencodeModelConfig {
  return {
    ...DEFAULT_BY_ROLE[role],
    ...(options.default ?? {}),
    ...(options.byRole?.[role] ?? {}),
  };
}

function extractSessionId(value: unknown): string | undefined {
  if (!isRecord(value)) {
    return undefined;
  }

  const direct =
    asString(value.session_id) ??
    asString(value.sessionID) ??
    asString(value.sessionId) ??
    asString(value.session);
  if (direct) {
    return direct;
  }

  if (isRecord(value.session)) {
    return asString(value.session.id);
  }

  return undefined;
}

function extractTextFromValue(value: unknown): string | undefined {
  if (typeof value === "string") {
    return value;
  }

  if (Array.isArray(value)) {
    const parts: string[] = [];
    for (const item of value) {
      const text = extractTextFromValue(item);
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
    asString(value.result) ??
    asString(value.output_text) ??
    asString(value.text) ??
    asString(value.content) ??
    extractTextFromValue(value.message) ??
    extractTextFromValue(value.item) ??
    extractTextFromValue(value.content)
  );
}

function extractErrorFromValue(value: unknown): string | undefined {
  if (!isRecord(value)) {
    return undefined;
  }

  const payloadType = asString(value.type) ?? asString(value.event) ?? asString(value.kind);
  const hasErrorSignal = value.is_error === true || payloadType === "error" || Boolean(value.error);

  if (!hasErrorSignal) {
    return undefined;
  }

  if (typeof value.error === "string") {
    return value.error;
  }

  if (isRecord(value.error)) {
    const nested = asString(value.error.message);
    if (nested) {
      return nested;
    }
  }

  return extractTextFromValue(value) ?? asString(value.message) ?? "OpenCode SDK returned an error.";
}

type ParsedResponse = {
  sessionId?: string;
  outputText?: string;
  error?: string;
};

function parseResponse(value: unknown): ParsedResponse {
  if (Array.isArray(value)) {
    const parsed: ParsedResponse = {};
    for (const item of value) {
      const next = parseResponse(item);
      if (next.sessionId) {
        parsed.sessionId = next.sessionId;
      }
      if (next.outputText) {
        parsed.outputText = next.outputText;
      }
      if (next.error) {
        parsed.error = next.error;
      }
    }
    return parsed;
  }

  return {
    sessionId: extractSessionId(value),
    outputText: extractTextFromValue(value),
    error: extractErrorFromValue(value),
  };
}

function isRunClient(client: OpencodeSdkClient): client is OpencodeRunClient {
  return typeof (client as OpencodeRunClient).run === "function";
}

function isResponsesClient(client: OpencodeSdkClient): client is OpencodeResponsesClient {
  const candidate = client as unknown;
  if (!isRecord(candidate)) {
    return false;
  }
  if (!isRecord(candidate.responses)) {
    return false;
  }
  return typeof candidate.responses.create === "function";
}

function resolveConstructor(mod: unknown): OpencodeSdkConstructor | null {
  if (typeof mod === "function") {
    return mod as OpencodeSdkConstructor;
  }

  if (!isRecord(mod)) {
    return null;
  }

  const direct = [mod.OpenCode, mod.Opencode, mod.default];
  for (const value of direct) {
    if (typeof value === "function") {
      return value as OpencodeSdkConstructor;
    }
  }

  if (typeof mod.createClient === "function") {
    return null;
  }

  if (isRecord(mod.default) && typeof mod.default.OpenCode === "function") {
    return mod.default.OpenCode as OpencodeSdkConstructor;
  }

  return null;
}

async function createDefaultClient(args: OpencodeClientFactoryArgs): Promise<OpencodeSdkClient> {
  try {
    const moduleId = "opencode-sdk";
    const mod = await import(moduleId);
    if (isRecord(mod) && typeof mod.createClient === "function") {
      const result = await mod.createClient(args.apiKey ? { apiKey: args.apiKey } : {});
      if (isRecord(result)) {
        return result as OpencodeSdkClient;
      }
    }

    const Ctor = resolveConstructor(mod);
    if (!Ctor) {
      throw new Error("OpenCode SDK constructor not found in module exports.");
    }
    return new Ctor(args.apiKey ? { apiKey: args.apiKey } : undefined);
  } catch (error) {
    throw new Error(
      `OpenCode SDK unavailable: ${getErrorMessage(error)}. Install opencode-sdk and set OPENCODE_API_KEY.`,
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

class OpencodeSdkRunner implements OttoRunner {
  readonly kind = "opencode-sdk";
  readonly id = "opencode-sdk";

  constructor(private readonly options: OpencodeSdkRunnerOptions = {}) {}

  async run(options: OttoRunnerRunOptions): Promise<OttoRunnerResult> {
    const cfg = mergeConfig(options.role, this.options);
    const apiKeyEnv = cfg.apiKeyEnvVar ?? this.options.apiKeyEnvVar ?? DEFAULT_API_KEY_ENV;

    let client: OpencodeSdkClient;
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

    const request: OpencodeRequest = {
      prompt: options.prompt,
      model: cfg.model,
      variant: cfg.variant,
      sessionId: options.sessionId,
      phaseName: options.phaseName,
      jsonSchema: options.jsonSchema,
    };

    let raw: unknown;
    try {
      let promise: Promise<unknown>;
      if (isRunClient(client)) {
        promise = client.run(request);
      } else if (isResponsesClient(client)) {
        promise = client.responses.create(request);
      } else {
        throw new Error("OpenCode SDK client does not expose run/response methods.");
      }

      const wrapped = await withTimeout(promise, options.timeoutMs ?? 10 * 60_000);
      if (wrapped.timedOut) {
        return {
          success: false,
          sessionId: options.sessionId,
          timedOut: true,
          error: "OpenCode SDK request timed out.",
        };
      }
      raw = wrapped.value;
    } catch (error) {
      const message = getErrorMessage(error);
      return {
        success: false,
        sessionId: options.sessionId,
        error: message,
        contextOverflow: CONTEXT_OVERFLOW_PATTERN.test(message),
      };
    }

    const parsed = parseResponse(raw);
    const outputText = parsed.outputText;
    const error = parsed.error;
    const sessionId = parsed.sessionId ?? options.sessionId;

    const overflowSource = [outputText, error].filter(Boolean).join("\n");
    const contextOverflow = CONTEXT_OVERFLOW_PATTERN.test(overflowSource);

    if (error) {
      return {
        success: false,
        sessionId,
        outputText,
        error,
        contextOverflow,
      };
    }

    if (!outputText) {
      return {
        success: false,
        sessionId,
        error: "OpenCode SDK did not return text output.",
      };
    }

    await emitAssistantText({
      onEvent: options.onEvent,
      messageId: `${this.id}-message-1`,
      text: outputText,
      rawEvent: raw,
    });

    return {
      success: true,
      sessionId,
      outputText,
      contextOverflow,
    };
  }
}

export function createOpencodeSdkRunner(options: OpencodeSdkRunnerOptions = {}): OttoRunner {
  return new OpencodeSdkRunner(options);
}
