export type OttoRole = "projectLead" | "lead" | "task" | "reviewer" | "summarize";

export type OttoLogLevel = "debug" | "info" | "warn" | "error";
export type OttoLogChannel =
  | "agent_message"
  | "reasoning"
  | "command"
  | "file_change"
  | "system"
  | "raw";

export interface OttoRunnerLog {
  runnerId: string;
  channel: OttoLogChannel;
  level: OttoLogLevel;
  message: string;
  raw?: unknown;
}

export interface OttoRunnerRunOptions {
  role: OttoRole;
  phaseName: string;
  prompt: string;
  cwd: string;
  exec: OttoExec;
  sessionId?: string;
  timeoutMs?: number;
  warmingTimeoutMs?: number;
  warmingRetries?: number;
  jsonSchema?: unknown;
}

export interface OttoRunnerResult {
  success: boolean;
  sessionId?: string;
  outputText?: string;
  contextOverflow?: boolean;
  timedOut?: boolean;
  error?: string;
}

export interface OttoRunner {
  readonly kind: string;
  readonly id: string;

  run(options: OttoRunnerRunOptions): Promise<OttoRunnerResult>;
}

export interface OttoExecResult {
  exitCode: number;
  stdout: string;
  stderr: string;
  timedOut: boolean;
}

export interface OttoExec {
  run(
    cmd: string[],
    options: {
      cwd: string;
      env?: Record<string, string>;
      timeoutMs?: number;
      stdin?: string;
      label?: string;
    },
  ): Promise<OttoExecResult>;
}

export interface OttoWorktreeInfo {
  mainRepoPath: string;
  worktreePath: string;
  branchName: string;
  baseBranch: string;
}

export interface OttoWorktreeAdapter {
  getMainRepoPath(cwd: string): Promise<string>;

  createWorktree(args: {
    mainRepoPath: string;
    baseBranch: string;
    branchName: string;
    worktreesDir?: string;
  }): Promise<{ worktreePath: string }>;

  removeWorktree(args: {
    mainRepoPath: string;
    worktreePath: string;
    branchName: string;
    deleteBranch: boolean;
  }): Promise<void>;
}

export interface OttoQualityCheck {
  name: string;
  cmd: string[];
  timeoutMs?: number;
  env?: Record<string, string>;
}

export interface OttoQualityCheckResult {
  name: string;
  ok: boolean;
  stdout: string;
  stderr: string;
}

export interface OttoQualityGateResult {
  ok: boolean;
  results: OttoQualityCheckResult[];
}

export interface OttoQualityGateAdapter {
  runChecks(args: {
    worktreePath: string;
    exec: OttoExec;
    checks: OttoQualityCheck[];
  }): Promise<OttoQualityGateResult>;
}

export interface OttoPromptAdapter {
  confirm(
    message: string,
    options?: { defaultValue?: boolean },
  ): Promise<boolean>;
  text(message: string, options?: { defaultValue?: string }): Promise<string>;
  select(
    message: string,
    options: { choices: string[]; defaultValue?: string },
  ): Promise<string>;
}
