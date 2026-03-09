import type {
  OttoRole,
  OttoRunner,
  OttoRunnerResult,
  OttoRunnerRunOptions,
} from "@otto/ports";

type ClaudeModelConfig = {
  model?: string;
  maxTokens?: number;
  temperature?: number;
  systemPrompt?: string;
  apiKeyEnvVar?: string;
};

type ClaudeClientFactoryArgs = {
  apiKey?: string;
};

type ClaudeMessagesApi = {
  create(input: Record<string, unknown>): Promise<unknown>;
};

type ClaudeSdkClient = {
  messages: ClaudeMessagesApi;
};

type ClaudeClientFactory = (
  args: ClaudeClientFactoryArgs,
) => ClaudeSdkClient | Promise<ClaudeSdkClient>;

export type ClaudeSdkRunnerOptions = {
  default?: ClaudeModelConfig;
  byRole?: Partial<Record<OttoRole, ClaudeModelConfig>>;
  apiKeyEnvVar?: string;
  client?: ClaudeSdkClient;
  clientFactory?: ClaudeClientFactory;
};

const DEFAULT_API_KEY_ENV = "ANTHROPIC_API_KEY";
const CONTEXT_OVERFLOW_PATTERN =
  /context|prompt.*too.*long|token.*limit|maximum context|too many tokens/i;

const DEFAULT_BY_ROLE: Record<OttoRole, ClaudeModelConfig> = {
  projectLead: { model: "claude-sonnet-4-5-20250929", maxTokens: 8_192 },
  lead: { model: "claude-sonnet-4-5-20250929", maxTokens: 8_192 },
  task: { model: "claude-sonnet-4-5-20250929", maxTokens: 8_192 },
  reviewer: { model: "claude-sonnet-4-5-20250929", maxTokens: 8_192 },
  summarize: { model: "claude-3-5-haiku-latest", maxTokens: 4_096 },
};

type JsonRecord = Record<string, unknown>;

type TimeoutResult<T> =
  | { timedOut: true }
  | { timedOut: false; value: T };

type ClaudeSdkConstructor = new (options?: {
  apiKey?: string;
}) => ClaudeSdkClient;

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

function mergeConfig(role: OttoRole, options: ClaudeSdkRunnerOptions): ClaudeModelConfig {
  return {
    ...DEFAULT_BY_ROLE[role],
    ...(options.default ?? {}),
    ...(options.byRole?.[role] ?? {}),
  };
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
  return "Unknown Claude SDK error.";
}

function extractTextFromContent(content: unknown): string | undefined {
  if (typeof content === "string") {
    return content;
  }

  if (!Array.isArray(content)) {
    return undefined;
  }

  const texts: string[] = [];
  for (const item of content) {
    if (!isRecord(item)) {
      continue;
    }
    if (asString(item.type) && asString(item.type) !== "text") {
      continue;
    }
    const text = asString(item.text);
    if (text) {
      texts.push(text);
    }
  }
  return texts.length > 0 ? texts.join("\n") : undefined;
}

function extractTextFromResponse(response: unknown): string | undefined {
  if (!isRecord(response)) {
    return undefined;
  }

  return (
    extractTextFromContent(response.content) ??
    asString(response.output_text) ??
    asString(response.text)
  );
}

function extractSessionId(response: unknown): string | undefined {
  if (!isRecord(response)) {
    return undefined;
  }
  return asString(response.id) ?? asString(response.session_id) ?? asString(response.sessionId);
}

function resolveClaudeSdkConstructor(mod: unknown): ClaudeSdkConstructor | null {
  if (typeof mod === "function") {
    return mod as ClaudeSdkConstructor;
  }

  if (!isRecord(mod)) {
    return null;
  }

  const direct = [mod.Anthropic, mod.default];
  for (const value of direct) {
    if (typeof value === "function") {
      return value as ClaudeSdkConstructor;
    }
  }

  if (isRecord(mod.default) && typeof mod.default.Anthropic === "function") {
    return mod.default.Anthropic as ClaudeSdkConstructor;
  }

  return null;
}

async function createDefaultClient(args: ClaudeClientFactoryArgs): Promise<ClaudeSdkClient> {
  try {
    const moduleId = "@anthropic-ai/sdk";
    const mod = await import(moduleId);
    const Ctor = resolveClaudeSdkConstructor(mod);
    if (!Ctor) {
      throw new Error("Anthropic constructor not found in module exports.");
    }
    return new Ctor(args.apiKey ? { apiKey: args.apiKey } : undefined);
  } catch (error) {
    throw new Error(
      `Anthropic SDK unavailable: ${getErrorMessage(error)}. Install @anthropic-ai/sdk and set ANTHROPIC_API_KEY.`,
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

class ClaudeSdkRunner implements OttoRunner {
  readonly kind = "claude-sdk";
  readonly id = "claude-sdk";

  constructor(private readonly options: ClaudeSdkRunnerOptions = {}) {}

  async run(options: OttoRunnerRunOptions): Promise<OttoRunnerResult> {
    const cfg = mergeConfig(options.role, this.options);
    const apiKeyEnv = cfg.apiKeyEnvVar ?? this.options.apiKeyEnvVar ?? DEFAULT_API_KEY_ENV;

    let client: ClaudeSdkClient;
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
      max_tokens: cfg.maxTokens,
      messages: [{ role: "user", content: options.prompt }],
    };
    if (cfg.systemPrompt) {
      request.system = cfg.systemPrompt;
    }
    if (typeof cfg.temperature === "number") {
      request.temperature = cfg.temperature;
    }

    let response: unknown;
    try {
      const wrapped = await withTimeout(
        client.messages.create(request),
        options.timeoutMs ?? 10 * 60_000,
      );
      if (wrapped.timedOut) {
        return {
          success: false,
          sessionId: options.sessionId,
          timedOut: true,
          error: "Claude SDK request timed out.",
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
        error: "Claude SDK did not return text output.",
      };
    }

    return {
      success: true,
      sessionId,
      outputText,
      contextOverflow: CONTEXT_OVERFLOW_PATTERN.test(outputText),
    };
  }
}

export function createClaudeSdkRunner(options: ClaudeSdkRunnerOptions = {}): OttoRunner {
  return new ClaudeSdkRunner(options);
}
