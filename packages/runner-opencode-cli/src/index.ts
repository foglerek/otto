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

type JsonRecord = Record<string, unknown>;

type ParsedOutput = {
  sessionId?: string;
  finalText?: string;
  finalError?: string;
  lastText?: string;
  sawFinalRecord: boolean;
  streamTextParts: string[];
  nonJsonLines: string[];
};

type RunnerAttempt = {
  execResult: Awaited<ReturnType<OttoRunnerRunOptions["exec"]["run"]>>;
  parsed: ParsedOutput;
  outputText: string;
  sessionId?: string;
  combined: string;
  contextOverflow: boolean;
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

function mergeConfig(role: OttoRole, options: OpencodeCliRunnerOptions): OpencodeModelConfig {
  return {
    ...DEFAULT_BY_ROLE[role],
    ...(options.default ?? {}),
    ...(options.byRole?.[role] ?? {}),
  };
}

function extractPayloadType(obj: JsonRecord): string | undefined {
  const raw = asString(obj.type) ?? asString(obj.event) ?? asString(obj.kind);
  if (!raw) {
    return undefined;
  }
  return raw.toLowerCase().replace(/-/g, "_");
}

function extractPartType(obj: JsonRecord): string | undefined {
  if (!isRecord(obj.part)) {
    return undefined;
  }
  const raw = asString(obj.part.type);
  if (!raw) {
    return undefined;
  }
  return raw.toLowerCase().replace(/-/g, "_");
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

  if (isRecord(obj.part)) {
    const partSession = asString(obj.part.sessionID) ?? asString(obj.part.sessionId);
    if (partSession) {
      return partSession;
    }
  }

  if (isRecord(obj.session)) {
    const nestedSession = asString(obj.session.id);
    if (nestedSession) {
      return nestedSession;
    }
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

  if (isRecord(obj.item)) {
    const itemText = asString(obj.item.text) ?? extractTextFromContent(obj.item.content);
    if (itemText) {
      return itemText;
    }
  }

  if (isRecord(obj.part)) {
    const partText = asString(obj.part.text) ?? extractTextFromContent(obj.part.content);
    if (partText) {
      return partText;
    }
  }

  return extractTextFromContent(obj.content);
}

function isFinalRecord(obj: JsonRecord): boolean {
  const payloadType = extractPayloadType(obj);
  const partType = extractPartType(obj);
  return (
    payloadType === "result" ||
    payloadType === "final" ||
    payloadType === "step_finish" ||
    partType === "step_finish" ||
    obj.final === true
  );
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

  return "OpenCode CLI returned an error result.";
}

function applyJsonRecord(parsed: ParsedOutput, obj: JsonRecord): void {
  const payloadType = extractPayloadType(obj);
  const partType = extractPartType(obj);
  const isTextPayload = payloadType === "text" || partType === "text";
  const isFinalPayload = isFinalRecord(obj);

  const sid = extractSessionId(obj);
  if (sid) {
    parsed.sessionId = sid;
  }

  const textCandidate = extractTextCandidate(obj);
  if (textCandidate) {
    parsed.lastText = textCandidate;
    if (isTextPayload) {
      parsed.streamTextParts.push(textCandidate);
    }
  }

  const maybeError = extractFinalError(obj, textCandidate);
  if (maybeError && isFinalPayload) {
    parsed.finalError = maybeError;
  }

  if (isFinalPayload && textCandidate) {
    parsed.finalText = textCandidate;
  }
}

function parseStreamJson(stdout: string): ParsedOutput {
  const parsed: ParsedOutput = {
    sawFinalRecord: false,
    streamTextParts: [],
    nonJsonLines: [],
  };

  for (const line of stdout.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed) {
      continue;
    }

    const obj = parseJsonLine(trimmed);
    if (!obj) {
      parsed.lastText = trimmed;
      parsed.nonJsonLines.push(trimmed);
      continue;
    }

    if (isFinalRecord(obj)) {
      parsed.sawFinalRecord = true;
    }

    applyJsonRecord(parsed, obj);
  }

  if (!parsed.finalText && parsed.streamTextParts.length > 0) {
    const joined = parsed.streamTextParts.join("").trim();
    if (joined.length > 0) {
      parsed.finalText = joined;
    }
  }

  return parsed;
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

class OpencodeCliRunner implements OttoRunner {
  readonly kind = "opencode-cli";
  readonly id = "opencode-cli";

  constructor(private readonly options: OpencodeCliRunnerOptions = {}) {}

  private async runAttempt(args: {
    runOptions: OttoRunnerRunOptions;
    cmd: string[];
    env?: Record<string, string>;
  }): Promise<RunnerAttempt> {
    const execResult = await args.runOptions.exec.run(args.cmd, {
      cwd: args.runOptions.cwd,
      timeoutMs: args.runOptions.timeoutMs ?? 10 * 60_000,
      label: `opencode:${args.runOptions.phaseName}:${args.runOptions.role}`,
      env: args.env,
    });

    const parsed = parseStreamJson(execResult.stdout);
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
