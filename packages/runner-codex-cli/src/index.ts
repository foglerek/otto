import type {
  OttoRole,
  OttoRunner,
  OttoRunnerResult,
  OttoRunnerRunOptions,
} from "@otto/ports";

type CodexModelConfig = {
  model?: string;
  extraArgs?: string[];
  env?: Record<string, string>;
  settingsPath?: string;
  settingsInline?: unknown;
};

export type CodexCliRunnerOptions = {
  binary?: string;
  default?: CodexModelConfig;
  byRole?: Partial<Record<OttoRole, CodexModelConfig>>;
};

const DEFAULT_BINARY = "codex";
const CONTEXT_OVERFLOW_PATTERN =
  /prompt is too long|context length|context window|maximum context/i;

const DEFAULT_BY_ROLE: Record<OttoRole, CodexModelConfig> = {
  projectLead: { model: "gpt-5-codex" },
  lead: { model: "gpt-5-codex" },
  task: { model: "gpt-5-codex" },
  reviewer: { model: "gpt-5-codex" },
  summarize: { model: "gpt-5-mini" },
};

function toJsonSchemaArg(schema: OttoRunnerRunOptions["jsonSchema"]): string | null {
  if (!schema) return null;
  return JSON.stringify(schema);
}

function mergeConfig(role: OttoRole, options: CodexCliRunnerOptions): CodexModelConfig {
  return {
    ...DEFAULT_BY_ROLE[role],
    ...(options.default ?? {}),
    ...(options.byRole?.[role] ?? {}),
  };
}

function buildArgs(args: {
  binary: string;
  run: OttoRunnerRunOptions;
  config: CodexModelConfig;
}): string[] {
  const cmd: string[] = [args.binary, "exec", "--json"];

  if (args.config.model) {
    cmd.push("--model", args.config.model);
  }

  if (args.config.settingsInline !== undefined) {
    cmd.push("--settings", JSON.stringify(args.config.settingsInline));
  } else if (args.config.settingsPath) {
    cmd.push("--settings", args.config.settingsPath);
  }

  const schemaArg = toJsonSchemaArg(args.run.jsonSchema);
  if (schemaArg) {
    cmd.push("--json-schema", schemaArg);
  }

  if (Array.isArray(args.config.extraArgs) && args.config.extraArgs.length > 0) {
    cmd.push(...args.config.extraArgs);
  }

  return cmd;
}

type ParsedOutput = {
  sessionId?: string;
  finalText?: string;
  finalError?: string;
};

function parseJsonLine(line: string): any | null {
  try {
    return JSON.parse(line);
  } catch {
    return null;
  }
}

function extractSessionId(obj: any): string | undefined {
  const sid = obj?.session_id ?? obj?.sessionId;
  if (typeof sid === "string" && sid.trim()) {
    return sid;
  }
  return undefined;
}

function extractTextCandidate(obj: any): string | undefined {
  if (typeof obj?.result === "string") return obj.result;
  if (typeof obj?.output_text === "string") return obj.output_text;
  if (typeof obj?.content === "string") return obj.content;
  if (typeof obj?.text === "string") return obj.text;
  return undefined;
}

function isFinalRecord(obj: any): boolean {
  return obj?.type === "result" || obj?.type === "final" || obj?.final === true;
}

function extractFinalError(obj: any, textCandidate?: string): string | undefined {
  if (!(obj?.is_error === true || obj?.error)) {
    return undefined;
  }
  if (typeof textCandidate === "string" && textCandidate.trim()) {
    return textCandidate;
  }
  if (typeof obj?.error === "string") {
    return obj.error;
  }
  return "Codex CLI returned an error result.";
}

function applyJsonRecord(parsed: ParsedOutput, obj: any): void {
  const sid = extractSessionId(obj);
  if (sid) {
    parsed.sessionId = sid;
  }

  if (!isFinalRecord(obj)) {
    return;
  }

  const textCandidate = extractTextCandidate(obj);
  if (typeof textCandidate === "string") {
    parsed.finalText = textCandidate;
  }

  const maybeError = extractFinalError(obj, textCandidate);
  if (maybeError) {
    parsed.finalError = maybeError;
  }
}

function parseStreamJson(stdout: string): ParsedOutput {
  const parsed: ParsedOutput = {};

  for (const line of stdout.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    const obj = parseJsonLine(trimmed);
    if (!obj) continue;
    applyJsonRecord(parsed, obj);
  }

  return parsed;
}

class CodexCliRunner implements OttoRunner {
  readonly kind = "codex-cli";
  readonly id = "codex-cli";

  constructor(private readonly options: CodexCliRunnerOptions = {}) {}

  async run(options: OttoRunnerRunOptions): Promise<OttoRunnerResult> {
    const cfg = mergeConfig(options.role, this.options);
    const binary = this.options.binary ?? DEFAULT_BINARY;
    const cmd = buildArgs({ binary, run: options, config: cfg });

    const execResult = await options.exec.run(cmd, {
      cwd: options.cwd,
      stdin: options.prompt,
      timeoutMs: options.timeoutMs ?? 10 * 60_000,
      label: `codex:${options.phaseName}:${options.role}`,
      env: cfg.env,
    });

    const parsed = parseStreamJson(execResult.stdout);
    const combined = [parsed.finalText, execResult.stdout, execResult.stderr]
      .filter(Boolean)
      .join("\n");
    const contextOverflow = CONTEXT_OVERFLOW_PATTERN.test(combined);

    if (!parsed.finalText && /spawn\s+codex\s+ENOENT/i.test(execResult.stderr)) {
      return {
        success: false,
        error: "Codex CLI not found (`codex` missing in PATH).",
        timedOut: execResult.timedOut,
      };
    }

    const outputText = parsed.finalText ?? execResult.stdout.trim();
    const sessionId = parsed.sessionId ?? options.sessionId;

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
          `Codex CLI exited with code ${execResult.exitCode}.`,
        contextOverflow,
        timedOut: execResult.timedOut,
      };
    }

    if (!outputText) {
      return {
        success: false,
        sessionId,
        outputText,
        error: "Codex CLI did not emit a final result.",
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

export function createCodexCliRunner(
  options: CodexCliRunnerOptions = {},
): OttoRunner {
  return new CodexCliRunner(options);
}
