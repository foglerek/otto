import type {
  OttoRole,
  OttoRunner,
  OttoRunnerResult,
  OttoRunnerRunOptions,
} from "@otto/ports";

type GeminiModelConfig = {
  model?: string;
  extraArgs?: string[];
  env?: Record<string, string>;
};

export type GeminiCliRunnerOptions = {
  binary?: string;
  default?: GeminiModelConfig;
  byRole?: Partial<Record<OttoRole, GeminiModelConfig>>;
};

const DEFAULT_BINARY = "gemini";
const CONTEXT_OVERFLOW_PATTERN =
  /(?:context|token).*(?:limit|exceeded|overflow)|too long/i;

const DEFAULT_BY_ROLE: Record<OttoRole, GeminiModelConfig> = {
  projectLead: { model: "gemini-3-pro-preview" },
  lead: { model: "gemini-3-pro-preview" },
  task: { model: "gemini-3-pro-preview" },
  reviewer: { model: "gemini-3-pro-preview" },
  summarize: { model: "gemini-2.5-flash" },
};

type JsonRecord = Record<string, unknown>;

type ParsedOutput = {
  sessionId?: string;
  finalText?: string;
  finalError?: string;
  lastText?: string;
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

function mergeConfig(role: OttoRole, options: GeminiCliRunnerOptions): GeminiModelConfig {
  return {
    ...DEFAULT_BY_ROLE[role],
    ...(options.default ?? {}),
    ...(options.byRole?.[role] ?? {}),
  };
}

function extractPayloadType(obj: JsonRecord): string | undefined {
  return asString(obj.type) ?? asString(obj.event) ?? asString(obj.kind);
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
  if (isRecord(obj.session)) {
    return asString(obj.session.id);
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

  return extractTextFromContent(obj.content);
}

function isFinalRecord(obj: JsonRecord): boolean {
  const payloadType = extractPayloadType(obj);
  return payloadType === "result" || payloadType === "final" || obj.final === true;
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

  return "Gemini CLI returned an error result.";
}

function applyJsonRecord(parsed: ParsedOutput, obj: JsonRecord): void {
  const sid = extractSessionId(obj);
  if (sid) {
    parsed.sessionId = sid;
  }

  const textCandidate = extractTextCandidate(obj);
  if (textCandidate) {
    parsed.lastText = textCandidate;
  }

  const maybeError = extractFinalError(obj, textCandidate);
  if (maybeError && isFinalRecord(obj)) {
    parsed.finalError = maybeError;
  }

  if (isFinalRecord(obj) && textCandidate) {
    parsed.finalText = textCandidate;
  }

  if (extractPayloadType(obj) === "error" && maybeError) {
    parsed.finalError = maybeError;
  }
}

function parseStreamJson(stdout: string): ParsedOutput {
  const parsed: ParsedOutput = {};

  for (const line of stdout.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed) {
      continue;
    }

    const obj = parseJsonLine(trimmed);
    if (!obj) {
      parsed.lastText = trimmed;
      continue;
    }

    applyJsonRecord(parsed, obj);
  }

  return parsed;
}

function buildArgs(args: {
  binary: string;
  run: OttoRunnerRunOptions;
  config: GeminiModelConfig;
}): string[] {
  const cmd: string[] = [args.binary, "--output-format", "stream-json", "--yolo"];

  if (args.config.model) {
    cmd.push("--model", args.config.model);
  }

  if (args.run.sessionId) {
    cmd.push("--resume", args.run.sessionId);
  }

  if (Array.isArray(args.config.extraArgs) && args.config.extraArgs.length > 0) {
    cmd.push(...args.config.extraArgs);
  }

  return cmd;
}

class GeminiCliRunner implements OttoRunner {
  readonly kind = "gemini-cli";
  readonly id = "gemini-cli";

  constructor(private readonly options: GeminiCliRunnerOptions = {}) {}

  async run(options: OttoRunnerRunOptions): Promise<OttoRunnerResult> {
    const cfg = mergeConfig(options.role, this.options);
    const binary = this.options.binary ?? DEFAULT_BINARY;
    const cmd = buildArgs({ binary, run: options, config: cfg });

    const execResult = await options.exec.run(cmd, {
      cwd: options.cwd,
      timeoutMs: options.timeoutMs ?? 10 * 60_000,
      label: `gemini:${options.phaseName}:${options.role}`,
      env: cfg.env,
      stdin: options.prompt,
    });

    const parsed = parseStreamJson(execResult.stdout);
    const outputText = parsed.finalText ?? parsed.lastText ?? execResult.stdout.trim();
    const sessionId = parsed.sessionId ?? options.sessionId;

    const combined = [outputText, execResult.stdout, execResult.stderr].filter(Boolean).join("\n");
    const contextOverflow = CONTEXT_OVERFLOW_PATTERN.test(combined);

    if (!outputText && /spawn\s+gemini\s+ENOENT/i.test(execResult.stderr)) {
      return {
        success: false,
        sessionId: options.sessionId,
        error: "Gemini CLI not found (`gemini` missing in PATH).",
      };
    }

    if (parsed.finalError) {
      return {
        success: false,
        sessionId,
        outputText,
        error: parsed.finalError,
        contextOverflow,
        timedOut: execResult.timedOut,
      };
    }

    if (execResult.exitCode !== 0) {
      return {
        success: false,
        sessionId,
        outputText,
        error:
          outputText ||
          execResult.stderr.trim() ||
          `Gemini CLI exited with code ${execResult.exitCode}.`,
        contextOverflow,
        timedOut: execResult.timedOut,
      };
    }

    if (!outputText) {
      return {
        success: false,
        sessionId,
        outputText,
        error: "Gemini CLI did not emit a final result.",
        contextOverflow,
        timedOut: execResult.timedOut,
      };
    }

    return {
      success: true,
      sessionId,
      outputText,
      contextOverflow,
      timedOut: execResult.timedOut,
    };
  }
}

export function createGeminiCliRunner(options: GeminiCliRunnerOptions = {}): OttoRunner {
  return new GeminiCliRunner(options);
}
