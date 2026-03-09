import { readFileSync } from "node:fs";

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
};

const DEFAULT_BINARY = "opencode";
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

function mergeConfig(role: OttoRole, options: OpencodeCliRunnerOptions): OpencodeModelConfig {
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

  return "OpenCode CLI returned an error result.";
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
  config: OpencodeModelConfig;
}): string[] {
  const cmd: string[] = [args.binary, "run", "--format", "json"];

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

    const execResult = await options.exec.run(cmd, {
      cwd: options.cwd,
      timeoutMs: options.timeoutMs ?? 10 * 60_000,
      label: `opencode:${options.phaseName}:${options.role}`,
      env,
    });

    const parsed = parseStreamJson(execResult.stdout);
    const outputText = parsed.finalText ?? parsed.lastText ?? execResult.stdout.trim();
    const sessionId = parsed.sessionId ?? options.sessionId;

    const combined = [outputText, execResult.stdout, execResult.stderr].filter(Boolean).join("\n");
    const contextOverflow = CONTEXT_OVERFLOW_PATTERN.test(combined);

    if (!outputText && /spawn\s+opencode\s+ENOENT/i.test(execResult.stderr)) {
      return {
        success: false,
        timedOut: execResult.timedOut,
        error: "OpenCode CLI not found (`opencode` missing in PATH).",
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
          `OpenCode CLI exited with code ${execResult.exitCode}.`,
        contextOverflow,
        timedOut: execResult.timedOut,
      };
    }

    if (!outputText) {
      return {
        success: false,
        sessionId,
        outputText,
        error: "OpenCode CLI did not emit a final result.",
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

export function createOpencodeCliRunner(
  options: OpencodeCliRunnerOptions = {},
): OttoRunner {
  return new OpencodeCliRunner(options);
}
