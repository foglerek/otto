import path from "node:path";

import type {
  OttoRole,
  OttoRunnerLog,
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

function mergeConfig(role: OttoRole, options: CodexCliRunnerOptions): CodexModelConfig {
  return {
    ...DEFAULT_BY_ROLE[role],
    ...(options.default ?? {}),
    ...(options.byRole?.[role] ?? {}),
  };
}

function resolveMainRepoPath(cwd: string): string | null {
  const marker = `${path.sep}.worktrees${path.sep}`;
  const idx = cwd.lastIndexOf(marker);
  if (idx <= 0) {
    return null;
  }
  const mainRepoPath = cwd.slice(0, idx);
  return mainRepoPath.length > 0 ? mainRepoPath : null;
}

function buildWritableRootsOverride(args: {
  cwd: string;
  mainRepoPath: string | null;
}): string | null {
  if (!args.mainRepoPath) {
    return null;
  }

  const roots = [
    path.resolve(args.cwd),
    path.resolve(path.join(args.mainRepoPath, ".otto")),
  ];
  const uniqueRoots = [...new Set(roots)];
  const encoded = uniqueRoots.map((root) => JSON.stringify(root)).join(",");
  return `sandbox_workspace_write.writable_roots=[${encoded}]`;
}

function buildArgs(args: {
  binary: string;
  run: OttoRunnerRunOptions;
  config: CodexModelConfig;
}): string[] {
  const mainRepoPath = resolveMainRepoPath(args.run.cwd);
  const globalArgs: string[] = [args.binary];
  const writableRootsOverride = buildWritableRootsOverride({
    cwd: args.run.cwd,
    mainRepoPath,
  });
  if (writableRootsOverride) {
    globalArgs.push("-c", writableRootsOverride);
  }

  const resumeMode = Boolean(args.run.sessionId);
  const cmd: string[] = resumeMode
    ? [
        ...globalArgs,
        "exec",
        "resume",
        "--json",
        args.run.sessionId as string,
      ]
    : [...globalArgs, "exec", "--json"];

  if (args.config.model) {
    cmd.push("--model", args.config.model);
  }

  if (args.config.settingsInline !== undefined) {
    cmd.push("--settings", JSON.stringify(args.config.settingsInline));
  } else if (args.config.settingsPath) {
    cmd.push("--settings", args.config.settingsPath);
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
  lastAgentMessage?: string;
  sawTerminalRecord: boolean;
  nonJsonLines: string[];
  logs: OttoRunnerLog[];
};

function parseJsonLine(line: string): any | null {
  try {
    return JSON.parse(line);
  } catch {
    return null;
  }
}

function asString(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function extractSessionId(obj: any): string | undefined {
  const sid =
    asString(obj?.session_id) ??
    asString(obj?.sessionId) ??
    asString(obj?.thread_id) ??
    asString(obj?.threadId);
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

function isTerminalRecord(obj: any): boolean {
  return isFinalRecord(obj) || obj?.type === "turn.completed";
}

function extractAgentMessage(obj: any): string | undefined {
  if (obj?.type === "item.completed" && obj?.item?.type === "agent_message") {
    return asString(obj?.item?.text);
  }
  if (obj?.type === "agent_message") {
    return asString(obj?.text);
  }
  return undefined;
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

  const message = extractAgentMessage(obj);
  if (message) {
    parsed.lastAgentMessage = message;
  }

  if (isTerminalRecord(obj)) {
    parsed.sawTerminalRecord = true;
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

function parseStreamJson(stdout: string, runnerId: string): ParsedOutput {
  const parsed: ParsedOutput = {
    sawTerminalRecord: false,
    nonJsonLines: [],
    logs: [],
  };

  for (const line of stdout.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    const obj = parseJsonLine(trimmed);
    if (!obj) {
      parsed.nonJsonLines.push(trimmed);
      parsed.logs.push({
        runnerId,
        channel: "raw",
        level: "debug",
        message: trimmed,
        raw: trimmed,
      });
      continue;
    }
    parsed.logs.push({
      runnerId,
      channel: "raw",
      level: "debug",
      message: trimmed,
      raw: obj,
    });
    applyJsonRecord(parsed, obj);
  }

  if (!parsed.finalText && parsed.lastAgentMessage) {
    parsed.finalText = parsed.lastAgentMessage;
  }

  return parsed;
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

class CodexCliRunner implements OttoRunner {
  readonly kind = "codex-cli";
  readonly id = "codex-cli";

  constructor(private readonly options: CodexCliRunnerOptions = {}) {}

  async run(options: OttoRunnerRunOptions): Promise<OttoRunnerResult> {
    const cfg = mergeConfig(options.role, this.options);
    const binary = this.options.binary ?? DEFAULT_BINARY;
    const cmd = buildArgs({ binary, run: options, config: cfg });

    let messageCount = 0;
    let lastLiveMessage = "";
    const execResult = await options.exec.run(cmd, {
      cwd: options.cwd,
      stdin: options.prompt,
      timeoutMs: options.timeoutMs ?? 10 * 60_000,
      label: `codex:${options.phaseName}:${options.role}`,
      env: cfg.env,
      onStdoutLine: async (line) => {
        const trimmed = line.trim();
        if (!trimmed) return;
        const obj = parseJsonLine(trimmed);
        if (!obj) return;

        const message = extractAgentMessage(obj);
        if (message && message !== lastLiveMessage) {
          lastLiveMessage = message;
          messageCount += 1;
          await emitAssistantText({
            onEvent: options.onEvent,
            messageId: `${this.id}-message-${messageCount}`,
            text: message,
            rawEvent: obj,
          });
          return;
        }

        if (isFinalRecord(obj)) {
          const textCandidate = extractTextCandidate(obj);
          if (textCandidate && textCandidate !== lastLiveMessage) {
            lastLiveMessage = textCandidate;
            messageCount += 1;
            await emitAssistantText({
              onEvent: options.onEvent,
              messageId: `${this.id}-message-${messageCount}`,
              text: textCandidate,
              rawEvent: obj,
            });
          }
        }
      },
    });

    const parsed = parseStreamJson(execResult.stdout, this.id);
    for (const entry of parsed.logs) {
      await options.onLog?.(entry);
    }
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

    if (!parsed.sawTerminalRecord) {
      return {
        success: false,
        sessionId,
        outputText,
        error: "Codex CLI did not emit a terminal JSON event.",
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
