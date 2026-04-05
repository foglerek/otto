import type {
  OttoRole,
  OttoRunner,
  OttoRunnerResult,
  OttoRunnerRunOptions,
} from "@otto/ports";

type GoogleModelConfig = {
  model?: string;
  apiKeyEnvVar?: string;
};

type GoogleClientFactoryArgs = {
  apiKey?: string;
};

type GoogleModelsApi = {
  generateContent(input: Record<string, unknown>): Promise<unknown>;
};

type GoogleGenAiClient = {
  models: GoogleModelsApi;
};

type GoogleClientFactory = (
  args: GoogleClientFactoryArgs,
) => GoogleGenAiClient | Promise<GoogleGenAiClient>;

export type GoogleGenAiRunnerOptions = {
  default?: GoogleModelConfig;
  byRole?: Partial<Record<OttoRole, GoogleModelConfig>>;
  apiKeyEnvVar?: string;
  client?: GoogleGenAiClient;
  clientFactory?: GoogleClientFactory;
};

const DEFAULT_API_KEY_ENV = "GOOGLE_API_KEY";
const CONTEXT_OVERFLOW_PATTERN =
  /context|prompt.*too.*long|token.*limit|maximum context|too many tokens/i;

const DEFAULT_BY_ROLE: Record<OttoRole, GoogleModelConfig> = {
  projectLead: { model: "gemini-2.5-pro" },
  lead: { model: "gemini-2.5-pro" },
  task: { model: "gemini-2.5-pro" },
  reviewer: { model: "gemini-2.5-pro" },
  summarize: { model: "gemini-2.5-flash" },
};

type JsonRecord = Record<string, unknown>;

type TimeoutResult<T> =
  | { timedOut: true }
  | { timedOut: false; value: T };

type GoogleGenAiConstructor = new (options?: {
  apiKey?: string;
}) => GoogleGenAiClient;

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
  return "Unknown Google GenAI SDK error.";
}

function mergeConfig(role: OttoRole, options: GoogleGenAiRunnerOptions): GoogleModelConfig {
  return {
    ...DEFAULT_BY_ROLE[role],
    ...(options.default ?? {}),
    ...(options.byRole?.[role] ?? {}),
  };
}

function extractFromParts(parts: unknown): string | undefined {
  if (!Array.isArray(parts)) {
    return undefined;
  }
  const chunks: string[] = [];
  for (const part of parts) {
    if (!isRecord(part)) {
      continue;
    }
    const text = asString(part.text);
    if (text) {
      chunks.push(text);
    }
  }
  return chunks.length > 0 ? chunks.join("\n") : undefined;
}

function extractTextFromResponse(response: unknown): string | undefined {
  if (!isRecord(response)) {
    return undefined;
  }

  const direct = asString(response.text) ?? asString(response.output_text) ?? asString(response.output);
  if (direct) {
    return direct;
  }

  if (typeof response.text === "function") {
    try {
      const fromFn = response.text.call(response) as unknown;
      const text = asString(fromFn);
      if (text) {
        return text;
      }
    } catch {
      // no-op
    }
  }

  if (!Array.isArray(response.candidates)) {
    return undefined;
  }

  const chunks: string[] = [];
  for (const candidate of response.candidates) {
    if (!isRecord(candidate) || !isRecord(candidate.content)) {
      continue;
    }
    const text = extractFromParts(candidate.content.parts);
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
  return asString(response.responseId) ?? asString(response.id) ?? asString(response.sessionId);
}

function resolveGoogleConstructor(mod: unknown): GoogleGenAiConstructor | null {
  if (typeof mod === "function") {
    return mod as GoogleGenAiConstructor;
  }

  if (!isRecord(mod)) {
    return null;
  }

  const direct = [mod.GoogleGenAI, mod.default];
  for (const value of direct) {
    if (typeof value === "function") {
      return value as GoogleGenAiConstructor;
    }
  }

  if (isRecord(mod.default) && typeof mod.default.GoogleGenAI === "function") {
    return mod.default.GoogleGenAI as GoogleGenAiConstructor;
  }

  return null;
}

async function createDefaultClient(args: GoogleClientFactoryArgs): Promise<GoogleGenAiClient> {
  try {
    const moduleId = "@google/genai";
    const mod = await import(moduleId);
    const Ctor = resolveGoogleConstructor(mod);
    if (!Ctor) {
      throw new Error("GoogleGenAI constructor not found in module exports.");
    }
    return new Ctor(args.apiKey ? { apiKey: args.apiKey } : undefined);
  } catch (error) {
    throw new Error(
      `Google GenAI SDK unavailable: ${getErrorMessage(error)}. Install @google/genai and set GOOGLE_API_KEY.`,
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

class GoogleGenAiRunner implements OttoRunner {
  readonly kind = "google-genai";
  readonly id = "google-genai";

  constructor(private readonly options: GoogleGenAiRunnerOptions = {}) {}

  async run(options: OttoRunnerRunOptions): Promise<OttoRunnerResult> {
    const cfg = mergeConfig(options.role, this.options);
    const apiKeyEnv = cfg.apiKeyEnvVar ?? this.options.apiKeyEnvVar ?? DEFAULT_API_KEY_ENV;

    let client: GoogleGenAiClient;
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
      contents: options.prompt,
    };

    if (options.jsonSchema) {
      request.config = {
        responseMimeType: "application/json",
        responseSchema: options.jsonSchema,
      };
    }

    let response: unknown;
    try {
      const wrapped = await withTimeout(
        client.models.generateContent(request),
        options.timeoutMs ?? 10 * 60_000,
      );
      if (wrapped.timedOut) {
        return {
          success: false,
          sessionId: options.sessionId,
          timedOut: true,
          error: "Google GenAI SDK request timed out.",
        };
      }
      response = wrapped.value;
    } catch (error) {
      const message = getErrorMessage(error);
      return {
        success: false,
        sessionId: options.sessionId,
        error: message,
        contextOverflow: CONTEXT_OVERFLOW_PATTERN.test(message),
      };
    }

    const outputText = extractTextFromResponse(response);
    const sessionId = extractSessionId(response) ?? options.sessionId;

    if (!outputText) {
      return {
        success: false,
        sessionId,
        error: "Google GenAI SDK did not return text output.",
      };
    }

    await emitAssistantText({
      onEvent: options.onEvent,
      messageId: `${this.id}-message-1`,
      text: outputText,
      rawEvent: response,
    });

    return {
      success: true,
      sessionId,
      outputText,
      contextOverflow: CONTEXT_OVERFLOW_PATTERN.test(outputText),
    };
  }
}

export function createGoogleGenAiRunner(
  options: GoogleGenAiRunnerOptions = {},
): OttoRunner {
  return new GoogleGenAiRunner(options);
}
