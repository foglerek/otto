import { useEffect, useState } from "react";

import { ensureSelectedRun } from "./helpers.js";
import type { AgUiEvent, AppState, ControlPlaneData, DashboardData, RunDetailData } from "./types.js";

const initialState: AppState = {
  dashboard: null,
  controlPlane: null,
  selectedRunId: null,
  viewMode: "overview",
  detailCache: {},
  agUiEventsByRun: {},
  ticketDraft: "",
  ingestDraft: "",
  ingestSourceName: "browser-ingest.md",
  projectStateDraft: "",
  promptDrafts: {},
  actionMessage: "",
  actionError: "",
  isCreatingTicket: false,
  isIngestingTicket: false,
  isSavingProjectState: false,
  isDeletingRun: false,
  liveStreamStatus: "connecting",
};

async function fetchJson<T>(url: string, options?: RequestInit): Promise<T> {
  const response = await fetch(url, { headers: { accept: "application/json", ...(options?.headers ?? {}) }, ...options });
  if (!response.ok) {
    let message = `Request failed: ${response.status}`;
    try {
      const data = (await response.json()) as { error?: string };
      if (typeof data.error === "string") message = data.error;
    } catch {
      const text = await response.text();
      if (text) message = text;
    }
    throw new Error(message);
  }
  return (await response.json()) as T;
}

function mergePromptDrafts(current: Record<string, string>, controlPlane: ControlPlaneData): Record<string, string> {
  const promptDrafts: Record<string, string> = {};
  for (const prompt of controlPlane.prompts) {
    if (prompt.kind === "text") {
      promptDrafts[prompt.id] = current[prompt.id] ?? (typeof prompt.defaultValue === "string" ? prompt.defaultValue : "");
    }
  }
  return promptDrafts;
}

function useInitialData(setState: React.Dispatch<React.SetStateAction<AppState>>, setFatalError: (message: string | null) => void) {
  useEffect(() => {
    let cancelled = false;
    void Promise.all([fetchJson<DashboardData>("/api/status"), fetchJson<ControlPlaneData>("/api/control-plane")])
      .then(([dashboard, controlPlane]) => {
        if (cancelled) return;
        setState((current) => ({
          ...current,
          dashboard,
          controlPlane,
          selectedRunId: ensureSelectedRun(dashboard, current.selectedRunId),
          projectStateDraft: current.projectStateDraft || dashboard.projectState.preview,
          promptDrafts: mergePromptDrafts(current.promptDrafts, controlPlane),
        }));
      })
      .catch((error) => {
        if (!cancelled) setFatalError(error instanceof Error ? error.message : String(error));
      });
    return () => {
      cancelled = true;
    };
  }, [setState, setFatalError]);
}

function useRunDetail(setState: React.Dispatch<React.SetStateAction<AppState>>, setFatalError: (message: string | null) => void, runId: string | null) {
  useEffect(() => {
    if (!runId) return;
    let cancelled = false;
    void fetchJson<RunDetailData>(`/api/runs/${encodeURIComponent(runId)}`)
      .then((detail) => {
        if (cancelled) return;
        setState((current) => ({
          ...current,
          detailCache: { ...current.detailCache, [detail.summary.runId]: detail },
          agUiEventsByRun: {
            ...current.agUiEventsByRun,
            [detail.summary.runId]: detail.recentAgUiEvents,
          },
        }));
      })
      .catch((error) => {
        if (!cancelled) setFatalError(error instanceof Error ? error.message : String(error));
      });
    return () => {
      cancelled = true;
    };
  }, [runId, setState, setFatalError]);
}

function useGeneralStream(setState: React.Dispatch<React.SetStateAction<AppState>>, runId: string | null) {
  useEffect(() => {
    const source = new EventSource(`/api/stream${runId ? `?runId=${encodeURIComponent(runId)}` : ""}`);
    source.addEventListener("open", () => setState((current) => ({ ...current, liveStreamStatus: "connected" })));
    source.addEventListener("dashboard", (event) => {
      const dashboard = JSON.parse((event as MessageEvent).data) as DashboardData;
      setState((current) => ({
        ...current,
        dashboard,
        selectedRunId: ensureSelectedRun(dashboard, current.selectedRunId),
        projectStateDraft: current.projectStateDraft || dashboard.projectState.preview,
      }));
    });
    source.addEventListener("control-plane", (event) => {
      const controlPlane = JSON.parse((event as MessageEvent).data) as ControlPlaneData;
      setState((current) => ({ ...current, controlPlane, promptDrafts: mergePromptDrafts(current.promptDrafts, controlPlane) }));
    });
    source.addEventListener("run-detail", (event) => {
      const payload = JSON.parse((event as MessageEvent).data) as { runId: string; detail: RunDetailData | null };
      setState((current) => {
        const detailCache = { ...current.detailCache };
        if (payload.detail) detailCache[payload.runId] = payload.detail;
        else delete detailCache[payload.runId];
        return { ...current, detailCache };
      });
    });
    source.addEventListener("error", () => setState((current) => ({ ...current, liveStreamStatus: "error" })));
    return () => source.close();
  }, [runId, setState]);
}

function useAgUiStream(setState: React.Dispatch<React.SetStateAction<AppState>>, runId: string | null) {
  useEffect(() => {
    if (!runId) return;
    const source = new EventSource(`/api/runs/${encodeURIComponent(runId)}/ag-ui`);
    source.onmessage = (event) => {
      const parsed = JSON.parse(event.data) as AgUiEvent;
      setState((current) => {
        const existing = current.agUiEventsByRun[runId] ?? [];
        const alreadySeen = existing.some((event) => JSON.stringify(event) === JSON.stringify(parsed));
        if (alreadySeen) {
          return current;
        }
        return { ...current, agUiEventsByRun: { ...current.agUiEventsByRun, [runId]: [...existing, parsed].slice(-80) } };
      });
    };
    return () => source.close();
  }, [runId, setState]);
}

export function useAppState(): {
  state: AppState;
  fatalError: string | null;
  selectedDetail: RunDetailData | null;
  setSelectedRunId: (runId: string) => void;
  setViewMode: (viewMode: "overview" | "details") => void;
  setTicketDraft: (value: string) => void;
  setIngestDraft: (value: string) => void;
  setIngestSourceName: (value: string) => void;
  setProjectStateDraft: (value: string) => void;
  setPromptDraft: (id: string, value: string) => void;
  setActionMessage: (message: string, error?: string) => void;
  setState: React.Dispatch<React.SetStateAction<AppState>>;
} {
  const [state, setState] = useState<AppState>(initialState);
  const [fatalError, setFatalError] = useState<string | null>(null);

  useInitialData(setState, setFatalError);
  useRunDetail(setState, setFatalError, state.selectedRunId);
  useGeneralStream(setState, state.selectedRunId);
  useAgUiStream(setState, state.selectedRunId);

  return {
    state,
    fatalError,
    selectedDetail: state.selectedRunId ? state.detailCache[state.selectedRunId] ?? null : null,
    setSelectedRunId: (runId) => setState((current) => ({ ...current, selectedRunId: runId })),
    setViewMode: (viewMode: "overview" | "details") => setState((current) => ({ ...current, viewMode })),
    setTicketDraft: (value) => setState((current) => ({ ...current, ticketDraft: value })),
  setIngestDraft: (value) => setState((current) => ({ ...current, ingestDraft: value })),
  setIngestSourceName: (value) => setState((current) => ({ ...current, ingestSourceName: value })),
    setProjectStateDraft: (value: string) => setState((current) => ({ ...current, projectStateDraft: value })),
    setPromptDraft: (id, value) => setState((current) => ({ ...current, promptDrafts: { ...current.promptDrafts, [id]: value } })),
    setActionMessage: (message, error = "") => setState((current) => ({ ...current, actionMessage: message, actionError: error })),
    setState,
  };
}
