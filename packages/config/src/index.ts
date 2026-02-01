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

export interface OttoAskMeta {
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

export interface OttoWorktreeConfig {
  baseBranch: string;
  worktreesDir?: string;
  branchNamer(args: { ask: OttoAskMeta }): string;
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
