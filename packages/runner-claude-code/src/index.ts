import type {
  OttoRole,
  OttoRunner,
  OttoRunnerResult,
  OttoRunnerRunOptions,
} from "@otto/ports";

type ClaudeStreamJsonLine = {
  type?: string;
  session_id?: string;
  result?: unknown;
  is_error?: boolean;
};

type ModelConfig = {
  model: string;
  thinking: boolean;
  maxThinkingTokens?: number;
  maxOutputTokens?: number;
  extraArgs?: string[];
  env?: Record<string, string>;
  settingsPath?: string;
  settingsInline?: unknown;
};

export type ClaudeCodeRunnerOptions = {
  default?: Partial<ModelConfig>;
  byRole?: Partial<Record<OttoRole, Partial<ModelConfig>>>;
};

const DEFAULT_ROLE_CONFIG: Record<OttoRole, ModelConfig> = {
  projectLead: {
    model: "claude-opus-4-5",
    thinking: true,
    maxThinkingTokens: 31999,
    maxOutputTokens: 32000,
  },
  lead: {
    model: "claude-opus-4-5",
    thinking: true,
    maxThinkingTokens: 31999,
    maxOutputTokens: 32000,
  },
  reviewer: {
    model: "claude-opus-4-5",
    thinking: true,
    maxThinkingTokens: 31999,
    maxOutputTokens: 32000,
  },
  task: {
    model: "claude-opus-4-5",
    thinking: true,
    maxThinkingTokens: 31999,
    maxOutputTokens: 32000,
  },
  summarize: {
    model: "claude-haiku-4-5",
    thinking: false,
  },
};

function getTimeoutMs(timeoutMs: number | undefined): number {
  return typeof timeoutMs === "number" && timeoutMs > 0 ? timeoutMs : 60_000;
}

function getModelConfig(
  role: OttoRunnerRunOptions["role"],
  options: ClaudeCodeRunnerOptions,
): ModelConfig {
  const base = DEFAULT_ROLE_CONFIG[role] ?? {
    model: "claude-sonnet-4-5",
    thinking: false,
  };

  const merged: ModelConfig = {
    ...base,
    ...options.default,
    ...options.byRole?.[role],
  };

  if (!merged.model) {
    merged.model = base.model;
  }

  if (typeof merged.thinking !== "boolean") {
    merged.thinking = base.thinking;
  }

  return merged;
}

function toJsonSchemaArg(schema: unknown): string | null {
  if (schema === undefined) return null;
  if (typeof schema === "string") return schema;
  return JSON.stringify(schema);
}

function buildClaudeArgs(
  options: OttoRunnerRunOptions,
  modelConfig: ModelConfig,
): string[] {
  const args: string[] = [
    "-p",
    "--output-format",
    "stream-json",
    "--verbose",
    "--dangerously-skip-permissions",
    "--model",
    modelConfig.model,
  ];

  if (options.sessionId) {
    args.push("--resume", options.sessionId);
  }

  if (modelConfig.settingsInline !== undefined) {
    args.push("--settings", JSON.stringify(modelConfig.settingsInline));
  } else if (modelConfig.settingsPath) {
    args.push("--settings", modelConfig.settingsPath);
  }

  const schemaArg = toJsonSchemaArg(options.jsonSchema);
  if (schemaArg) {
    args.push("--json-schema", schemaArg);
  }

  if (Array.isArray(modelConfig.extraArgs) && modelConfig.extraArgs.length > 0) {
    args.push(...modelConfig.extraArgs);
  }

  return args;
}

function buildClaudeEnv(modelConfig: ModelConfig): Record<string, string> {
  return {
    ...(modelConfig.maxThinkingTokens
      ? { MAX_THINKING_TOKENS: String(modelConfig.maxThinkingTokens) }
      : {}),
    ...(modelConfig.maxOutputTokens
      ? {
          CLAUDE_CODE_MAX_OUTPUT_TOKENS: String(modelConfig.maxOutputTokens),
        }
      : {}),
    ...(modelConfig.env ?? {}),
  };
}

function parseStreamJsonLine(line: string): ClaudeStreamJsonLine | null {
  if (!line.trim()) return null;
  try {
    return JSON.parse(line) as ClaudeStreamJsonLine;
  } catch {
    return null;
  }
}

function parseStreamJsonOutput(args: {
  stdout: string;
  initialSessionId?: string;
}): { sessionId?: string; finalText?: string; finalIsError: boolean } {
  let sessionId: string | undefined = args.initialSessionId;
  let finalText: string | undefined;
  let finalIsError = false;

  const lines = args.stdout.split(/\r?\n/);
  for (const line of lines) {
    const parsed = parseStreamJsonLine(line);
    if (!parsed) continue;

    if (typeof parsed.session_id === "string") {
      sessionId = parsed.session_id;
    }

    if (parsed.type === "result") {
      finalIsError = parsed.is_error === true;
      finalText = typeof parsed.result === "string" ? parsed.result : undefined;
    }
  }

  return { sessionId, finalText, finalIsError };
}

function computeContextOverflow(args: {
  stdout: string;
  stderr: string;
  finalText?: string;
}): boolean {
  return /prompt is too long/i.test(
    `${args.finalText ?? ""}\n${args.stdout}\n${args.stderr}`,
  );
}

function isMissingClaudeCli(stderr: string): boolean {
  return /spawn\s+claude\s+enoent/i.test(stderr);
}

class ClaudeCodeRunner implements OttoRunner {
  readonly kind = "claude-code";
  readonly id = "claude-code";

  constructor(private readonly options: ClaudeCodeRunnerOptions = {}) {}

  async run(options: OttoRunnerRunOptions): Promise<OttoRunnerResult> {
    const modelConfig = getModelConfig(options.role, this.options);
    const timeoutMs = getTimeoutMs(options.timeoutMs);
    const claudeArgs = buildClaudeArgs(options, modelConfig);

    const execResult = await options.exec.run(["claude", ...claudeArgs], {
      cwd: options.cwd,
      env: buildClaudeEnv(modelConfig),
      timeoutMs,
      stdin: options.prompt,
      label: `claude:${options.phaseName}:${options.role}`,
    });

    const parsed = parseStreamJsonOutput({
      stdout: execResult.stdout,
      initialSessionId: options.sessionId,
    });

    const contextOverflow = computeContextOverflow({
      stdout: execResult.stdout,
      stderr: execResult.stderr,
      finalText: parsed.finalText,
    });

    if (!parsed.finalText) {
      const missingCli = isMissingClaudeCli(execResult.stderr);
      return {
        success: false,
        sessionId: parsed.sessionId,
        timedOut: execResult.timedOut,
        contextOverflow,
        error: missingCli
          ? "Claude Code CLI not found (missing `claude` in PATH)."
          : "Claude Code did not emit a final result.",
      };
    }

    if (parsed.finalIsError) {
      return {
        success: false,
        sessionId: parsed.sessionId,
        outputText: parsed.finalText,
        timedOut: execResult.timedOut,
        contextOverflow,
        error: parsed.finalText,
      };
    }

    return {
      success: true,
      sessionId: parsed.sessionId,
      outputText: parsed.finalText,
      timedOut: execResult.timedOut,
      contextOverflow,
    };
  }
}

export function createClaudeCodeRunner(
  options: ClaudeCodeRunnerOptions = {},
): OttoRunner {
  return new ClaudeCodeRunner(options);
}
