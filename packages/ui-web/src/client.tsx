import React from "react";
import { createRoot } from "react-dom/client";

import { AppLayout, ErrorState, ShellLoading } from "./components.js";
import type { OverviewPanel } from "./project-shell.js";
import type { ControlPlaneData, DashboardData } from "./types.js";
import { useAppState } from "./use-app-state.js";

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

async function postJson<T>(url: string, body?: unknown): Promise<T> {
  return await fetchJson<T>(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
}

function App(): React.JSX.Element {
  const app = useAppState();
  const [overviewPanel, setOverviewPanel] = React.useState<OverviewPanel>(null);

  async function refresh() {
    try {
      const [dashboard, controlPlane] = await Promise.all([
        fetchJson<DashboardData>("/api/status"),
        fetchJson<ControlPlaneData>("/api/control-plane"),
      ]);
      app.setState((current) => ({ ...current, dashboard, controlPlane }));
    } catch (error) {
      app.setActionMessage("", error instanceof Error ? error.message : String(error));
    }
  }

  async function createTicket() {
    if (!app.state.ticketDraft.trim()) return;
    app.setState((current) => ({ ...current, isCreatingTicket: true, actionError: "", actionMessage: "" }));
    try {
      const result = await postJson<{ ticketId: string }>("/api/tickets/create", { ticketText: app.state.ticketDraft });
      app.setState((current) => ({ ...current, ticketDraft: "", isCreatingTicket: false, actionMessage: `Created ticket ${result.ticketId}.` }));
      await refresh();
    } catch (error) {
      app.setState((current) => ({ ...current, isCreatingTicket: false, actionError: error instanceof Error ? error.message : String(error) }));
    }
  }

  async function ingestTicket() {
    if (!app.state.ingestDraft.trim()) return;
    app.setState((current) => ({ ...current, isIngestingTicket: true, actionError: "", actionMessage: "" }));
    try {
      const result = await postJson<{ ticketId: string }>("/api/tickets/ingest", { sourceText: app.state.ingestDraft, sourceName: app.state.ingestSourceName });
      app.setState((current) => ({ ...current, ingestDraft: "", ingestSourceName: "browser-ingest.md", isIngestingTicket: false, actionMessage: `Ingested ticket ${result.ticketId}.` }));
      await refresh();
    } catch (error) {
      app.setState((current) => ({ ...current, isIngestingTicket: false, actionError: error instanceof Error ? error.message : String(error) }));
    }
  }

  async function startRun(ticketId: string) {
    try {
      await postJson("/api/runs/start", { ticketId });
      app.setState((current) => ({ ...current, selectedRunId: ticketId, actionMessage: `Started run job for ${ticketId}.`, actionError: "" }));
    } catch (error) {
      app.setActionMessage("", error instanceof Error ? error.message : String(error));
    }
  }

  async function resumeRun(runId: string) {
    try {
      await postJson(`/api/runs/${encodeURIComponent(runId)}/resume`);
      app.setState((current) => ({ ...current, selectedRunId: runId, actionMessage: `Started resume job for ${runId}.`, actionError: "" }));
    } catch (error) {
      app.setActionMessage("", error instanceof Error ? error.message : String(error));
    }
  }

  async function mergeBackRun(runId: string) {
    try {
      await postJson(`/api/runs/${encodeURIComponent(runId)}/merge-back`);
      app.setState((current) => ({ ...current, selectedRunId: runId, actionMessage: `Started merge-back job for ${runId}.`, actionError: "" }));
    } catch (error) {
      app.setActionMessage("", error instanceof Error ? error.message : String(error));
    }
  }

  async function deleteRun(runId: string) {
    app.setState((current) => ({ ...current, isDeletingRun: true, actionError: "", actionMessage: "" }));
    try {
      const result = await postJson<{ runId: string }>(`/api/runs/${encodeURIComponent(runId)}/delete`);
      app.setState((current) => {
        const detailCache = { ...current.detailCache };
        delete detailCache[runId];
        return { ...current, isDeletingRun: false, selectedRunId: current.selectedRunId === runId ? null : current.selectedRunId, detailCache, actionMessage: `Deleted run ${result.runId}.` };
      });
      await refresh();
    } catch (error) {
      app.setState((current) => ({ ...current, isDeletingRun: false, actionError: error instanceof Error ? error.message : String(error) }));
    }
  }

  async function toggleDone(runId: string, markedDone: boolean) {
    try {
      await postJson(`/api/runs/${encodeURIComponent(runId)}/mark-done`, { markedDone });
      app.setState((current) => ({ ...current, actionMessage: markedDone ? `Marked ${runId} done.` : `Reopened ${runId}.`, actionError: "" }));
      await refresh();
    } catch (error) {
      app.setActionMessage("", error instanceof Error ? error.message : String(error));
    }
  }

  async function respondPrompt(id: string, value: boolean | string) {
    try {
      await postJson(`/api/prompts/${encodeURIComponent(id)}/respond`, { value });
      app.setState((current) => {
        const promptDrafts = { ...current.promptDrafts };
        delete promptDrafts[id];
        return { ...current, promptDrafts, actionMessage: "Submitted prompt response.", actionError: "" };
      });
    } catch (error) {
      app.setActionMessage("", error instanceof Error ? error.message : String(error));
    }
  }

  async function saveProjectState() {
    app.setState((current) => ({ ...current, isSavingProjectState: true, actionError: "", actionMessage: "" }));
    try {
      await postJson("/api/project-state", { content: app.state.projectStateDraft });
      app.setState((current) => ({ ...current, isSavingProjectState: false, actionMessage: "Saved project state." }));
      await refresh();
    } catch (error) {
      app.setState((current) => ({ ...current, isSavingProjectState: false, actionError: error instanceof Error ? error.message : String(error) }));
    }
  }

  if (app.fatalError) return <ErrorState message={app.fatalError} />;
  if (!app.state.dashboard || !app.state.controlPlane) return <ShellLoading />;

  return (
    <AppLayout
      state={app.state}
      selectedDetail={app.selectedDetail}
      onSetViewMode={app.setViewMode}
      overviewPanel={overviewPanel}
      onSetOverviewPanel={setOverviewPanel}
      onSelectRun={app.setSelectedRunId}
      onRefresh={() => void refresh()}
      onCreateTicket={() => void createTicket()}
      onIngestTicket={() => void ingestTicket()}
      onTicketDraftChange={app.setTicketDraft}
      onIngestDraftChange={app.setIngestDraft}
      onIngestSourceNameChange={app.setIngestSourceName}
      onProjectStateDraftChange={app.setProjectStateDraft}
      onSaveProjectState={() => void saveProjectState()}
      onIngestFile={(file) => void file.text().then((text) => app.setState((current) => ({ ...current, ingestSourceName: file.name || "browser-ingest.md", ingestDraft: text })))}
      onStartRun={(ticketId) => void startRun(ticketId)}
      onRespondPrompt={(id, value) => void respondPrompt(id, value)}
      onPromptDraftChange={app.setPromptDraft}
      onResumeRun={(runId) => void resumeRun(runId)}
      onMergeBackRun={(runId) => void mergeBackRun(runId)}
      onDeleteRun={(runId) => void deleteRun(runId)}
      onToggleDone={(runId, markedDone) => void toggleDone(runId, markedDone)}
    />
  );
}

const rootElement = document.getElementById("app");
if (!rootElement) throw new Error("Missing #app root element.");
createRoot(rootElement).render(<App />);
