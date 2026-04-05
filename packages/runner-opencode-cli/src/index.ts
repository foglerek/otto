import { mkdtemp, rm } from "node:fs/promises";
import { readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import type {
  OttoRole,
  OttoRunner,
  OttoRunnerResult,
  OttoRunnerRunOptions,
} from "@otto/ports";

import { analyzeLine, parseStreamJson, type ParsedOutput } from "./parsing.js";

type OpencodeModelConfig = {
  model?: string;
  variant?: string;
  extraArgs?: string[];
  env?: Record<string, string>;
  settingsPath?: string;
  settingsInline?: unknown;
};

export type OpencodeCliRunnerOptions = {
  binary?: string;
  default?: OpencodeModelConfig;
  byRole?: Partial<Record<OttoRole, OpencodeModelConfig>>;
  isolateConfigRetry?: boolean;
};

const DEFAULT_BINARY = "opencode";
const CONTEXT_OVERFLOW_PATTERN =
  /context|prompt.*too.*long|token.*limit|maximum context|too many tokens/i;
const INTERNAL_FAILURE_PATTERN =
  /schema validation failure|zoderror|invalid_format|must start with "prt"/i;
const ISOLATED_CONFIG_RECOVERY_PATTERN = /must start with "prt"|createusermessage/i;

const DEFAULT_BY_ROLE: Record<OttoRole, OpencodeModelConfig> = {
  projectLead: { model: "openai/gpt-5.3-codex", variant: "xhigh" },
  lead: { model: "openai/gpt-5.3-codex", variant: "xhigh" },
  task: { model: "openai/gpt-5.3-codex" },
  reviewer: { model: "openai/gpt-5.3-codex", variant: "high" },
  summarize: { model: "openai/gpt-5.3-codex", variant: "high" },
};

type RunnerAttempt = {
  execResult: Awaited<ReturnType<OttoRunnerRunOptions["exec"]["run"]>>;
  parsed: ParsedOutput;
  outputText: string;
  sessionId?: string;
  combined: string;
  contextOverflow: boolean;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function mergeConfig(role: OttoRole, options: OpencodeCliRunnerOptions): OpencodeModelConfig {
  return {
    ...DEFAULT_BY_ROLE[role],
    ...(options.default ?? {}),
    ...(options.byRole?.[role] ?? {}),
  };
}


function hasInternalFailureSignature(attempt: RunnerAttempt): boolean {
  if (INTERNAL_FAILURE_PATTERN.test(attempt.execResult.stderr)) {
    return true;
  }

  if (attempt.parsed.nonJsonLines.length > 0) {
    const nonJsonText = attempt.parsed.nonJsonLines.join("\n");
    if (INTERNAL_FAILURE_PATTERN.test(nonJsonText)) {
      return true;
    }
  }

  return false;
}

function truncateForError(text: string, maxChars = 4000): string {
  if (text.length <= maxChars) {
    return text;
  }
  return `${text.slice(0, maxChars)}\n...[truncated ${text.length - maxChars} chars]`;
}

function buildArgs(args: {
  binary: string;
  run: OttoRunnerRunOptions;
  config: OpencodeModelConfig;
}): string[] {
  const cmd: string[] = [args.binary, "run", "--format", "json"];

  const worktreesMarker = `${path.sep}.worktrees${path.sep}`;
  const markerIndex = args.run.cwd.lastIndexOf(worktreesMarker);
  if (markerIndex > 0) {
    const mainRepoPath = args.run.cwd.slice(0, markerIndex);
    if (mainRepoPath.length > 0) {
      cmd.push("--dir", mainRepoPath);
    }
  }

  if (args.config.model) {
    cmd.push("--model", args.config.model);
  }

  if (args.config.variant) {
    cmd.push("--variant", args.config.variant);
  }

  if (args.run.sessionId) {
    cmd.push("--session", args.run.sessionId);
  }

  if (args.run.phaseName) {
    cmd.push("--title", args.run.phaseName);
  }

  if (Array.isArray(args.config.extraArgs) && args.config.extraArgs.length > 0) {
    cmd.push(...args.config.extraArgs);
  }

  cmd.push(args.run.prompt);
  return cmd;
}

function buildEnv(config: OpencodeModelConfig): Record<string, string> | undefined {
  const env = { ...(config.env ?? {}) };

  if (config.settingsInline !== undefined) {
    env.OPENCODE_CONFIG_CONTENT = JSON.stringify(config.settingsInline);
  } else if (config.settingsPath) {
    env.OPENCODE_CONFIG_CONTENT = readFileSync(config.settingsPath, "utf8");
  }

  return Object.keys(env).length > 0 ? env : undefined;
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
  await args.onEvent({
    type: "TEXT_MESSAGE_START",
    messageId: args.messageId,
    role: "assistant",
    timestamp,
    rawEvent: args.rawEvent,
  });
  await args.onEvent({
    type: "TEXT_MESSAGE_CONTENT",
    messageId: args.messageId,
    delta: args.text,
    timestamp,
    rawEvent: args.rawEvent,
  });
  await args.onEvent({
    type: "TEXT_MESSAGE_END",
    messageId: args.messageId,
    timestamp,
    rawEvent: args.rawEvent,
  });
}

async function emitToolCallStart(args: {
  onEvent: OttoRunnerRunOptions["onEvent"];
  toolCallId: string;
  toolCallName: string;
  input?: unknown;
  rawEvent?: unknown;
}): Promise<void> {
  if (!args.onEvent) {
    return;
  }
  const timestamp = Date.now();
  await args.onEvent({
    type: "TOOL_CALL_START",
    toolCallId: args.toolCallId,
    toolCallName: args.toolCallName,
    timestamp,
    rawEvent: args.rawEvent,
  });
  await args.onEvent({
    type: "TOOL_CALL_ARGS",
    toolCallId: args.toolCallId,
    delta: JSON.stringify(args.input ?? {}),
    timestamp,
    rawEvent: args.rawEvent,
  });
}

async function emitToolCallEnd(args: {
  onEvent: OttoRunnerRunOptions["onEvent"];
  toolCallId: string;
  resultText: string;
  rawEvent?: unknown;
}): Promise<void> {
  if (!args.onEvent) {
    return;
  }
  const timestamp = Date.now();
  await args.onEvent({
    type: "TOOL_CALL_END",
    toolCallId: args.toolCallId,
    timestamp,
    rawEvent: args.rawEvent,
  });
  await args.onEvent({
    type: "TOOL_CALL_RESULT",
    messageId: `tool-result-${args.toolCallId}`,
    toolCallId: args.toolCallId,
    content: args.resultText,
    role: "tool",
    timestamp,
    rawEvent: args.rawEvent,
  });
}

class OpencodeCliRunner implements OttoRunner {
  readonly kind = "opencode-cli";
  readonly id = "opencode-cli";

  constructor(private readonly options: OpencodeCliRunnerOptions = {}) {}

  private async runAttempt(args: {
    runOptions: OttoRunnerRunOptions;
    cmd: string[];
    env?: Record<string, string>;
  }): Promise<RunnerAttempt> {
    let messageCount = 0;
    let lastLiveMessage = "";
    const execResult = await args.runOptions.exec.run(args.cmd, {
      cwd: args.runOptions.cwd,
      timeoutMs: args.runOptions.timeoutMs ?? 10 * 60_000,
      label: `opencode:${args.runOptions.phaseName}:${args.runOptions.role}`,
      env: args.env,
      onStdoutLine: async (line) => {
        const analysis = analyzeLine(line);
        const raw = analysis?.raw;
        if (raw && isRecord(raw) && raw.type === "tool_use" && isRecord(raw.part)) {
          const toolCallId = asString(raw.part.callID);
          const toolCallName = asString(raw.part.tool);
          const state = isRecord(raw.part.state) ? raw.part.state : null;
          if (toolCallId && toolCallName) {
            await emitToolCallStart({
              onEvent: args.runOptions.onEvent,
              toolCallId,
              toolCallName,
              input: state && isRecord(state.input) ? state.input : raw.part.input,
              rawEvent: raw,
            });
            if (state && asString(state.status) === "completed") {
              await emitToolCallEnd({
                onEvent: args.runOptions.onEvent,
                toolCallId,
                resultText: asString(state.output) ?? "",
                rawEvent: raw,
              });
            }
          }
          return;
        }
        if (!analysis?.text) {
          return;
        }
        if (!analysis.isTextPayload && !analysis.isFinalPayload) {
          return;
        }
        if (analysis.text === lastLiveMessage) {
          return;
        }
        lastLiveMessage = analysis.text;
        messageCount += 1;
        await emitAssistantText({
          onEvent: args.runOptions.onEvent,
          messageId: `${this.id}-message-${messageCount}`,
          text: analysis.text,
          rawEvent: analysis.raw,
        });
      },
    });

    const parsed = parseStreamJson(execResult.stdout);
    for (const entry of parsed.logs) {
      await args.runOptions.onLog?.(entry);
    }
    const outputText = parsed.finalText ?? parsed.lastText ?? execResult.stdout.trim();
    const sessionId = parsed.sessionId ?? args.runOptions.sessionId;
    const combined = [outputText, execResult.stdout, execResult.stderr].filter(Boolean).join("\n");
    const contextOverflow = CONTEXT_OVERFLOW_PATTERN.test(combined);

    return {
      execResult,
      parsed,
      outputText,
      sessionId,
      combined,
      contextOverflow,
    };
  }

  private formatInternalFailure(attempt: RunnerAttempt, retryAttempt?: RunnerAttempt): OttoRunnerResult {
    const details = truncateForError(
      [attempt.execResult.stderr.trim(), attempt.outputText].filter(Boolean).join("\n"),
    );
    const retryNote = retryAttempt
      ? truncateForError(
          [retryAttempt.execResult.stderr.trim(), retryAttempt.outputText].filter(Boolean).join("\n"),
        )
      : "";

    return {
      success: false,
      sessionId: attempt.sessionId,
      outputText: attempt.outputText,
      error:
        retryNote.length > 0
          ? [
              details.length > 0
                ? `OpenCode CLI emitted an internal schema/validation failure.\n${details}`
                : "OpenCode CLI emitted an internal schema/validation failure.",
              `Retry with isolated OpenCode config also failed.\n${retryNote}`,
            ].join("\n\n")
          : details.length > 0
            ? `OpenCode CLI emitted an internal schema/validation failure.\n${details}`
            : "OpenCode CLI emitted an internal schema/validation failure.",
      contextOverflow: attempt.contextOverflow,
      timedOut: attempt.execResult.timedOut,
    };
  }

  private finalizeAttempt(attempt: RunnerAttempt): OttoRunnerResult {
    if (!attempt.outputText && /spawn\s+opencode\s+ENOENT/i.test(attempt.execResult.stderr)) {
      return {
        success: false,
        timedOut: attempt.execResult.timedOut,
        error: "OpenCode CLI not found (`opencode` missing in PATH).",
      };
    }

    if (attempt.parsed.finalError) {
      return {
        success: false,
        sessionId: attempt.sessionId,
        outputText: attempt.outputText,
        error: attempt.parsed.finalError,
        contextOverflow: attempt.contextOverflow,
        timedOut: attempt.execResult.timedOut,
      };
    }

    if (attempt.execResult.exitCode !== 0) {
      return {
        success: false,
        sessionId: attempt.sessionId,
        outputText: attempt.outputText,
        error:
          attempt.outputText ||
          attempt.execResult.stderr.trim() ||
          `OpenCode CLI exited with code ${attempt.execResult.exitCode}.`,
        contextOverflow: attempt.contextOverflow,
        timedOut: attempt.execResult.timedOut,
      };
    }

    if (!attempt.parsed.sawFinalRecord) {
      const details = truncateForError(attempt.execResult.stderr.trim() || attempt.outputText);
      return {
        success: false,
        sessionId: attempt.sessionId,
        outputText: attempt.outputText,
        error:
          details.length > 0
            ? `OpenCode CLI did not emit a final JSON result.\n${details}`
            : "OpenCode CLI did not emit a final JSON result.",
        contextOverflow: attempt.contextOverflow,
        timedOut: attempt.execResult.timedOut,
      };
    }

    if (!attempt.outputText) {
      return {
        success: false,
        sessionId: attempt.sessionId,
        outputText: attempt.outputText,
        error: "OpenCode CLI did not emit a final result.",
        contextOverflow: attempt.contextOverflow,
        timedOut: attempt.execResult.timedOut,
      };
    }

    return {
      success: true,
      sessionId: attempt.sessionId,
      outputText: attempt.outputText,
      contextOverflow: attempt.contextOverflow,
      timedOut: attempt.execResult.timedOut,
    };
  }

  async run(options: OttoRunnerRunOptions): Promise<OttoRunnerResult> {
    const cfg = mergeConfig(options.role, this.options);
    const binary = this.options.binary ?? DEFAULT_BINARY;
    const cmd = buildArgs({ binary, run: options, config: cfg });

    let env: Record<string, string> | undefined;
    try {
      env = buildEnv(cfg);
    } catch (error) {
      return {
        success: false,
        sessionId: options.sessionId,
        error: `OpenCode settings configuration failed: ${(error as Error).message}`,
      };
    }

    const firstAttempt = await this.runAttempt({ runOptions: options, cmd, env });

    if (hasInternalFailureSignature(firstAttempt)) {
      const shouldRetryIsolatedConfig =
        (this.options.isolateConfigRetry ?? true) &&
        ISOLATED_CONFIG_RECOVERY_PATTERN.test(
          [firstAttempt.execResult.stderr, ...firstAttempt.parsed.nonJsonLines]
            .filter(Boolean)
            .join("\n"),
        );
      if (shouldRetryIsolatedConfig) {
        let retryAttempt: RunnerAttempt | undefined;
        const isolatedConfigHome = await mkdtemp(path.join(tmpdir(), "otto-opencode-config-"));
        try {
          retryAttempt = await this.runAttempt({
            runOptions: options,
            cmd,
            env: {
              ...(env ?? {}),
              XDG_CONFIG_HOME: isolatedConfigHome,
            },
          });
        } finally {
          await rm(isolatedConfigHome, { recursive: true, force: true });
        }

        if (!hasInternalFailureSignature(retryAttempt)) {
          return this.finalizeAttempt(retryAttempt);
        }

        return this.formatInternalFailure(firstAttempt, retryAttempt);
      }

      return this.formatInternalFailure(firstAttempt);
    }

    return this.finalizeAttempt(firstAttempt);
  }
}

export function createOpencodeCliRunner(
  options: OpencodeCliRunnerOptions = {},
): OttoRunner {
  return new OpencodeCliRunner(options);
}
