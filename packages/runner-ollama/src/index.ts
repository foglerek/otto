import type {
  OttoRole,
  OttoRunner,
  OttoRunnerResult,
  OttoRunnerRunOptions,
} from "@otto/ports";

type OllamaModelConfig = {
  model?: string;
  extraArgs?: string[];
  env?: Record<string, string>;
};

export type OllamaRunnerOptions = {
  binary?: string;
  default?: OllamaModelConfig;
  byRole?: Partial<Record<OttoRole, OllamaModelConfig>>;
};

const DEFAULT_BINARY = "ollama";
const CONTEXT_OVERFLOW_PATTERN =
  /context|prompt.*too.*long|token.*limit|maximum context|too many tokens/i;

const DEFAULT_BY_ROLE: Record<OttoRole, OllamaModelConfig> = {
  projectLead: { model: "llama3.1" },
  lead: { model: "llama3.1" },
  task: { model: "llama3.1" },
  reviewer: { model: "llama3.1" },
  summarize: { model: "llama3.1" },
};

type JsonRecord = Record<string, unknown>;

type ParsedOutput = {
  text?: string;
  error?: string;
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

function asText(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  return value.length > 0 ? value : undefined;
}

function parseJsonLine(line: string): JsonRecord | null {
  try {
    const parsed = JSON.parse(line) as unknown;
    return isRecord(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function mergeConfig(role: OttoRole, options: OllamaRunnerOptions): OllamaModelConfig {
  return {
    ...DEFAULT_BY_ROLE[role],
    ...(options.default ?? {}),
    ...(options.byRole?.[role] ?? {}),
  };
}

function extractJsonText(obj: JsonRecord): string | undefined {
  const response =
    asText(obj.response) ??
    asText(obj.result) ??
    asText(obj.output_text) ??
    asText(obj.text) ??
    asText(obj.content);
  if (response) {
    return response;
  }

  if (isRecord(obj.message)) {
    return asText(obj.message.content) ?? asText(obj.message.text);
  }

  return undefined;
}

function extractJsonError(obj: JsonRecord): string | undefined {
  if (typeof obj.error === "string") {
    return obj.error;
  }
  if (isRecord(obj.error)) {
    const message = asString(obj.error.message);
    if (message) {
      return message;
    }
  }

  const type = asString(obj.type) ?? asString(obj.event) ?? asString(obj.kind);
  if (type === "error") {
    return asString(obj.message) ?? "Ollama returned an error event.";
  }

  return undefined;
}

function parseOutput(stdout: string): ParsedOutput {
  const textParts: string[] = [];
  let fallbackText: string | undefined;
  let error: string | undefined;

  for (const line of stdout.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed) {
      continue;
    }

    const obj = parseJsonLine(trimmed);
    if (!obj) {
      fallbackText = trimmed;
      continue;
    }

    const maybeError = extractJsonError(obj);
    if (maybeError) {
      error = maybeError;
    }

    const maybeText = extractJsonText(obj);
    if (maybeText) {
      textParts.push(maybeText);
    }
  }

  const text = textParts.length > 0 ? textParts.join("") : fallbackText;
  return { text, error };
}

function buildArgs(args: {
  binary: string;
  run: OttoRunnerRunOptions;
  config: OllamaModelConfig;
}): string[] {
  const model = args.config.model ?? "llama3.1";
  const cmd: string[] = [args.binary, "run", model];

  if (Array.isArray(args.config.extraArgs) && args.config.extraArgs.length > 0) {
    cmd.push(...args.config.extraArgs);
  }

  cmd.push(args.run.prompt);
  return cmd;
}

class OllamaRunner implements OttoRunner {
  readonly kind = "ollama";
  readonly id = "ollama";

  constructor(private readonly options: OllamaRunnerOptions = {}) {}

  async run(options: OttoRunnerRunOptions): Promise<OttoRunnerResult> {
    const cfg = mergeConfig(options.role, this.options);
    const binary = this.options.binary ?? DEFAULT_BINARY;
    const cmd = buildArgs({ binary, run: options, config: cfg });

    const execResult = await options.exec.run(cmd, {
      cwd: options.cwd,
      timeoutMs: options.timeoutMs ?? 10 * 60_000,
      label: `ollama:${options.phaseName}:${options.role}`,
      env: cfg.env,
    });

    const parsed = parseOutput(execResult.stdout);
    const outputText = parsed.text ?? execResult.stdout.trim();
    const combined = [outputText, execResult.stdout, execResult.stderr].filter(Boolean).join("\n");
    const contextOverflow = CONTEXT_OVERFLOW_PATTERN.test(combined);

    if (!outputText && /spawn\s+ollama\s+ENOENT/i.test(execResult.stderr)) {
      return {
        success: false,
        error: "Ollama CLI not found (`ollama` missing in PATH).",
      };
    }

    if (parsed.error) {
      return {
        success: false,
        outputText,
        error: parsed.error,
        contextOverflow,
        timedOut: execResult.timedOut,
      };
    }

    if (execResult.exitCode !== 0) {
      return {
        success: false,
        outputText,
        error:
          outputText ||
          execResult.stderr.trim() ||
          `Ollama CLI exited with code ${execResult.exitCode}.`,
        contextOverflow,
        timedOut: execResult.timedOut,
      };
    }

    if (!outputText) {
      return {
        success: false,
        outputText,
        error: "Ollama CLI did not produce output.",
        contextOverflow,
        timedOut: execResult.timedOut,
      };
    }

    return {
      success: true,
      sessionId: options.sessionId,
      outputText,
      contextOverflow,
      timedOut: execResult.timedOut,
    };
  }
}

export function createOllamaRunner(options: OllamaRunnerOptions = {}): OttoRunner {
  return new OllamaRunner(options);
}
