import type { AgUiEvent, AppState, ControlPlaneJob, ControlPlanePrompt, DashboardData } from "./types.js";

export function formatDate(value: string | number | undefined): string {
  if (!value) return "-";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? String(value) : date.toLocaleString();
}

export function getActiveJobs(controlPlane: AppState["controlPlane"]): ControlPlaneJob[] {
  return (controlPlane?.jobs ?? []).filter((job) => job.status === "running" || job.status === "waiting");
}

export function isRunBusy(controlPlane: AppState["controlPlane"], runId: string): boolean {
  return getActiveJobs(controlPlane).some((job) => job.runId === runId);
}

export function ensureSelectedRun(dashboard: DashboardData | null, selectedRunId: string | null): string | null {
  const runs = dashboard?.runs ?? [];
  if (runs.length === 0) {
    return null;
  }
  return runs.some((run) => run.runId === selectedRunId) ? selectedRunId : runs[0].runId;
}

export function statusBadgeClass(status: string): string {
  if (status === "active") return "active";
  if (status === "stale" || status === "failed") return "stale";
  if (status === "waiting") return "waiting";
  return "done";
}

export function getPromptDraft(promptDrafts: Record<string, string>, prompt: ControlPlanePrompt): string {
  const draft = promptDrafts[prompt.id];
  if (typeof draft === "string") {
    return draft;
  }
  return typeof prompt.defaultValue === "string" ? prompt.defaultValue : "";
}

export function truncateText(value: string | undefined, maxChars: number): string {
  if (!value || value.length <= maxChars) {
    return value ?? "";
  }
  return `${value.slice(0, maxChars)}\n...[truncated ${value.length - maxChars} chars]`;
}

export function classifyAgUiEvent(event: AgUiEvent): string {
  if (event.type === "RUN_ERROR") return "error";
  if (event.type.startsWith("TOOL_CALL")) return "tool";
  if (event.type.startsWith("TEXT_MESSAGE")) return "message";
  if (event.type === "CUSTOM" && event.name === "otto.reasoning") return "reasoning";
  if (event.type === "CUSTOM" && event.name === "otto.control_plane") return "control";
  if (event.type === "RAW") return "raw";
  return "neutral";
}
