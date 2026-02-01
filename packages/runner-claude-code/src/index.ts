import type {
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
};

function getTimeoutMs(timeoutMs: number | undefined): number {
  return typeof timeoutMs === "number" && timeoutMs > 0 ? timeoutMs : 60_000;
}

function getModelConfig(role: OttoRunnerRunOptions["role"]): ModelConfig {
  // Mirrors the legacy task-manager defaults.
  if (role === "lead" || role === "reviewer" || role === "task") {
    return {
      model: "claude-opus-4-5",
      thinking: true,
      maxThinkingTokens: 31999,
      maxOutputTokens: 32000,
    };
  }

  if (role === "summarize") {
    return { model: "claude-haiku-4-5", thinking: false };
  }

  return { model: "claude-sonnet-4-5", thinking: false };
}

function toJsonSchemaArg(schema: unknown): string | null {
  if (schema === undefined) return null;
  if (typeof schema === "string") return schema;
  return JSON.stringify(schema);
}

function buildClaudeArgs(
  options: OttoRunnerRunOptions,
  model: string,
): string[] {
  const args: string[] = [
    "-p",
    "--output-format",
    "stream-json",
    "--verbose",
    "--dangerously-skip-permissions",
    "--model",
    model,
  ];

  if (options.sessionId) {
    args.push("--resume", options.sessionId);
  }

  const schemaArg = toJsonSchemaArg(options.jsonSchema);
  if (schemaArg) {
    args.push("--json-schema", schemaArg);
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

  async run(options: OttoRunnerRunOptions): Promise<OttoRunnerResult> {
    const modelConfig = getModelConfig(options.role);
    const timeoutMs = getTimeoutMs(options.timeoutMs);
    const claudeArgs = buildClaudeArgs(options, modelConfig.model);

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

export function createClaudeCodeRunner(): OttoRunner {
  return new ClaudeCodeRunner();
}
