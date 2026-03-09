import type {
  OttoQualityCheck,
  OttoRole,
  OttoWorktreeAdapter,
  OttoRunner,
  OttoExec,
  OttoPromptAdapter,
  OttoQualityGateAdapter,
  OttoWorktreeInfo,
} from "@otto/ports";

export interface OttoTicketMeta {
  date: string;
  slug: string;
  filePath: string;
}

export interface OttoBootstrapServices {
  database?: {
    ensure(): Promise<{ url: string }>;
  };
  devServer?: {
    start(): Promise<{ urls: string[] }>;
    stop(): Promise<void>;
  };
}

export interface OttoWorktreeHookContext {
  worktree: OttoWorktreeInfo;
  exec: OttoExec;
  env: {
    set(key: string, value: string): void;
  };
  testEnv: {
    set(key: string, value: string): void;
  };
  services: OttoBootstrapServices;
  logger: {
    info(message: string, meta?: Record<string, unknown>): void;
    warn(message: string, meta?: Record<string, unknown>): void;
    error(message: string, meta?: Record<string, unknown>): void;
  };
}

export interface OttoRunnersConfig {
  default: OttoRunner;
  byRole?: Partial<Record<OttoRole, OttoRunner>>;
}

export interface OttoQualityConfig {
  checks: OttoQualityCheck[];
  adapter: OttoQualityGateAdapter;
}

export interface OttoIntegrationConfig {
  checks: OttoQualityCheck[];
  adapter?: OttoQualityGateAdapter;
}

export interface OttoSummariesConfig {
  reportMaxChars?: number;
  reviewMaxChars?: number;
  maxAttempts?: number;
}

export interface OttoRetryPolicyConfig {
  autoRetryLimit?: number;
  decisionCardsMaxIterations?: number;
  qualityFixMaxAttempts?: number;
}

export interface OttoWorkflowPhaseHookContext {
  phase: string;
  state: unknown;
  exec: OttoExec;
}

export interface OttoWorkflowStepHookContext extends OttoWorkflowPhaseHookContext {
  step: string;
}

export interface OttoWorkflowPhaseAfterHookContext
  extends OttoWorkflowPhaseHookContext {
  result?: unknown;
  error?: string;
}

export interface OttoWorkflowStepAfterHookContext
  extends OttoWorkflowStepHookContext {
  result?: unknown;
  error?: string;
}

export interface OttoWorkflowHooksConfig {
  beforePhase?(ctx: OttoWorkflowPhaseHookContext): Promise<void>;
  afterPhase?(ctx: OttoWorkflowPhaseAfterHookContext): Promise<void>;
  beforeStep?(ctx: OttoWorkflowStepHookContext): Promise<void>;
  afterStep?(ctx: OttoWorkflowStepAfterHookContext): Promise<void>;
}

export interface OttoSubagentStrategyConfig {
  enabled?: boolean;
  maxConcurrent?: number;
  byRole?: Partial<Record<OttoRole, OttoRunner>>;
}

export interface OttoWorktreeConfig {
  baseBranch: string;
  worktreesDir?: string;
  branchNamer(args: { ticket: OttoTicketMeta }): string;
  afterCreate(ctx: OttoWorktreeHookContext): Promise<void>;
  beforeCleanup?(ctx: OttoWorktreeHookContext): Promise<void>;
  adapter: OttoWorktreeAdapter;
}

export interface OttoConfig {
  paths?: {
    artifactRoot?: string;
  };

  worktree: OttoWorktreeConfig;

  runners: OttoRunnersConfig;

  quality?: OttoQualityConfig;

  summaries?: OttoSummariesConfig;

  retryPolicy?: OttoRetryPolicyConfig;

  hooks?: OttoWorkflowHooksConfig;

  subagents?: OttoSubagentStrategyConfig;

  // Post-merge / integration-only checks (optional). If adapter is omitted,
  // Otto will fall back to `quality.adapter`.
  integration?: OttoIntegrationConfig;

  prompt?: {
    adapter: OttoPromptAdapter;
  };
}

export function defineOttoConfig(config: OttoConfig): OttoConfig {
  return config;
}
