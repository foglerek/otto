import type { AgUiEvent, AppState, ControlPlaneJob, ControlPlanePrompt, DashboardData, DashboardRunSummary } from "./types.js";

export const PHASE_ORDER = [
  "ticket-ingestion",
  "decision-cards",
  "plan-feedback",
  "task-splitting",
  "task-feedback",
  "execution",
  "user-feedback",
  "integration",
  "finalize",
  "cleanup",
] as const;

export const PHASE_GROUPS = [
  {
    title: "Planning",
    steps: [
      { label: "Ingest", phases: ["ticket-ingestion", "decision-cards"] },
      { label: "Plan", phases: ["plan-feedback"] },
      { label: "Split", phases: ["task-splitting", "task-feedback"] },
    ],
  },
  {
    title: "Execute",
    steps: [
      { label: "Prepare", phases: ["task-feedback"] },
      { label: "Implement", phases: ["execution"] },
      { label: "Review", phases: ["user-feedback"] },
    ],
  },
  {
    title: "Finalize",
    steps: [
      { label: "Merge", phases: ["integration"] },
      { label: "Report", phases: ["finalize"] },
      { label: "Cleanup", phases: ["cleanup"] },
    ],
  },
] as const;

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
  if (status === "running") return "active";
  if (status === "paused") return "waiting";
  if (status === "errored") return "stale";
  if (status === "stale" || status === "failed") return "stale";
  if (status === "waiting") return "waiting";
  return "done";
}

export function getRunDisplayStatus(run: DashboardRunSummary): "running" | "paused" | "errored" | "done" {
  if (run.isMarkedDone) return "done";
  if (run.processStatus === "active") return "running";
  if (run.processStatus === "stale") return "errored";
  if (run.needsUserInput) return "paused";
  if (run.processStatus === "inactive") return "paused";
  return "paused";
}

export function getRunStatusNote(run: DashboardRunSummary): string {
  const status = getRunDisplayStatus(run);
  if (status === "running") {
    return run.needsUserInput ? "Active, but blocked on operator input." : "Actively working through the queue.";
  }
  if (status === "errored") {
    return "Needs recovery or operator attention before continuing.";
  }
  if (status === "done") {
    return run.markedDoneAt ? `Marked done ${formatDate(run.markedDoneAt)}.` : "Finished and out of the active queue.";
  }
  if (run.needsUserInput) {
    return "Waiting on a prompt response before work can continue.";
  }
  if (run.finalReportAvailable) {
    return "Ready for merge-back, cleanup, or final review.";
  }
  return "Inactive and resumable from the current workflow phase.";
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

export function compactRunStages(phase: string | null): {
  previous: string | null;
  current: string;
  next: string | null;
} {
  const normalized = phase && PHASE_ORDER.includes(phase as (typeof PHASE_ORDER)[number]) ? phase : "execution";
  const index = PHASE_ORDER.indexOf(normalized as (typeof PHASE_ORDER)[number]);
  return {
    previous: index > 0 ? PHASE_ORDER[index - 1] : null,
    current: PHASE_ORDER[index],
    next: index < PHASE_ORDER.length - 1 ? PHASE_ORDER[index + 1] : null,
  };
}

export function presentStageName(value: string | null): string {
  if (!value) return "-";
  return value.replace(/-/g, " ");
}

export function fullPhaseProgress(phase: string | null): Array<{
  name: string;
  state: "done" | "current" | "remaining";
}> {
  const normalized = phase && PHASE_ORDER.includes(phase as (typeof PHASE_ORDER)[number]) ? phase : "execution";
  const index = PHASE_ORDER.indexOf(normalized as (typeof PHASE_ORDER)[number]);
  return PHASE_ORDER.map((name, itemIndex) => ({
    name,
    state: itemIndex < index ? "done" : itemIndex === index ? "current" : "remaining",
  }));
}

export function groupedPhaseProgress(phase: string | null): Array<{
  title: string;
  state: "done" | "current" | "remaining";
  steps: Array<{
    name: string;
    state: "done" | "current" | "remaining";
  }>;
}> {
  const normalized = phase && PHASE_ORDER.includes(phase as (typeof PHASE_ORDER)[number]) ? phase : "execution";
  const currentIndex = PHASE_ORDER.indexOf(normalized as (typeof PHASE_ORDER)[number]);
  return PHASE_GROUPS.map((group) => {
    const steps = group.steps.map((step) => {
      const indexes = step.phases
        .map((name) => PHASE_ORDER.indexOf(name as (typeof PHASE_ORDER)[number]))
        .filter((value) => value >= 0);
      const firstIndex = Math.min(...indexes);
      const lastIndex = Math.max(...indexes);
      const state = indexes.includes(currentIndex)
        ? "current"
        : currentIndex > lastIndex
          ? "done"
          : "remaining";
      return {
        name: step.label,
        state,
      };
    }) as Array<{
      name: string;
      state: "done" | "current" | "remaining";
    }>;
    const state = steps.some((step) => step.state === "current")
      ? "current"
      : steps.every((step) => step.state === "done")
        ? "done"
        : "remaining";
    return {
      title: group.title,
      state,
      steps,
    };
  });
}

export function visiblePhaseProgress(
  phase: string | null,
  visibleStepCount: number,
): Array<{
  title: string;
  state: "done" | "current" | "remaining";
  steps: Array<{
    name: string;
    state: "done" | "current" | "remaining";
  }>;
}> {
  const groups = groupedPhaseProgress(phase);
  const flattened = groups.flatMap((group) => group.steps.map((step) => ({ ...step, title: group.title })));
  const currentIndex = Math.max(0, flattened.findIndex((item) => item.state === "current"));
  const clampedCount = Math.max(1, Math.min(visibleStepCount, flattened.length));
  const start = Math.max(0, Math.min(currentIndex - Math.floor(clampedCount / 2), flattened.length - clampedCount));
  const visible = flattened.slice(start, start + clampedCount);

  const result: Array<{
    title: string;
    state: "done" | "current" | "remaining";
    steps: Array<{
      name: string;
      state: "done" | "current" | "remaining";
    }>;
  }> = [];

  for (const item of visible) {
    const previous = result[result.length - 1];
    if (previous?.title === item.title) {
      previous.steps.push({ name: item.name, state: item.state });
      previous.state = previous.steps.some((step) => step.state === "current")
        ? "current"
        : previous.steps.every((step) => step.state === "done")
          ? "done"
          : "remaining";
      continue;
    }
    result.push({
      title: item.title,
      state: item.state,
      steps: [{ name: item.name, state: item.state }],
    });
  }

  return result;
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
