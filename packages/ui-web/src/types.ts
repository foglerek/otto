export interface DashboardRunSummary {
  runId: string;
  ticketSlug: string;
  createdAt: string;
  branchName: string;
  baseBranch: string;
  phase: string | null;
  processStatus: "active" | "inactive" | "stale";
  isMarkedDone: boolean;
  markedDoneAt: string | null;
  lockPid: number | null;
  needsUserInput: boolean;
  taskQueueLength: number;
  planAvailable: boolean;
  finalReportAvailable: boolean;
}

export interface DashboardTicketSummary {
  ticketId: string;
  hasRun: boolean;
}

export interface DashboardData {
  repoPath: string;
  configPath: string;
  artifactRootDir: string;
  defaultRunnerId: string | null;
  subagentsEnabled: boolean;
  onboardingStatus: string | null;
  ticketsCount: number;
  tickets: DashboardTicketSummary[];
  runCounts: {
    total: number;
    active: number;
    inactive: number;
    stale: number;
  };
  runs: DashboardRunSummary[];
}

export interface RunArtifact {
  id: string;
  title: string;
  path: string;
  exists: boolean;
  language: string;
  content: string | null;
  truncated: boolean;
}

export interface RunEvent {
  at: string;
  type: string;
  data?: Record<string, unknown>;
}

export interface ExecEvent {
  at: string;
  label: string;
  exitCode: number;
  timedOut: boolean;
  durationMs: number;
}

export interface RunDetailData {
  summary: DashboardRunSummary;
  ticketFilePath: string;
  worktreePath: string;
  stateFilePath: string;
  runFiles: string[];
  artifacts: RunArtifact[];
  recentEvents: RunEvent[];
  recentExecs: ExecEvent[];
}

export interface ControlPlaneJob {
  id: string;
  kind: string;
  runId: string;
  status: string;
  startedAt: string;
  finishedAt?: string;
  error?: string;
  result?: unknown;
}

export interface ControlPlanePrompt {
  id: string;
  jobId: string;
  runId: string;
  kind: "confirm" | "text" | "select";
  message: string;
  choices?: string[];
  defaultValue?: string | boolean;
  createdAt: string;
}

export interface ControlPlaneData {
  jobs: ControlPlaneJob[];
  prompts: ControlPlanePrompt[];
}

export interface AgUiEvent {
  type: string;
  timestamp?: number;
  name?: string;
  source?: string;
  messageId?: string;
  runId?: string;
  toolCallId?: string;
  toolCallName?: string;
  delta?: string;
  content?: string;
  result?: unknown;
  value?: any;
  event?: unknown;
  rawEvent?: unknown;
  message?: string;
}

export interface AppState {
  dashboard: DashboardData | null;
  controlPlane: ControlPlaneData | null;
  selectedRunId: string | null;
  viewMode: "overview" | "details";
  detailCache: Record<string, RunDetailData>;
  agUiEventsByRun: Record<string, AgUiEvent[]>;
  ticketDraft: string;
  ingestDraft: string;
  ingestSourceName: string;
  promptDrafts: Record<string, string>;
  actionMessage: string;
  actionError: string;
  isCreatingTicket: boolean;
  isIngestingTicket: boolean;
  isDeletingRun: boolean;
  liveStreamStatus: "connecting" | "connected" | "error";
}
