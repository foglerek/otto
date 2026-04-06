import React from "react";

import { summarizeAgUiEvent } from "./ag-ui-summary.js";
import { buildAgUiTimeline, splitAgUiEvents, type AgUiTimelineItem } from "./ag-ui-timeline.js";
import { CollapsibleCard } from "./disclosure.js";
import { ProjectOverview, type OverviewPanel } from "./project-shell.js";
import { RunDetailStats, RunProgressStrip } from "./run-detail-chrome.js";
import {
  classifyAgUiEvent,
  formatDate,
  getActiveJobs,
  getPromptDraft,
  isRunBusy,
  statusBadgeClass,
} from "./helpers.js";
import type {
  AgUiEvent,
  AppState,
  ControlPlanePrompt,
  DashboardData,
  DashboardRunSummary,
  RunArtifact,
  RunDetailData,
} from "./types.js";

function NarrativeIcon(props: { item: Pick<AgUiTimelineItem, "title"> & { icon?: AgUiTimelineItem["icon"] } }): React.JSX.Element | null {
  if (!props.item.icon) {
    return null;
  }
  return <img className="narrative-icon" src={`/static/icons/${props.item.icon}.png`} alt={`${props.item.title} source`} />;
}

export function ShellLoading(): React.JSX.Element {
  return (
    <div className="shell-loading">
      <span className="shell-mark">OTTO</span>
      <p>Loading local control plane...</p>
    </div>
  );
}

export function ErrorState(props: { message: string }): React.JSX.Element {
  return (
    <div className="error-state">
      <div>
        <span className="wordmark">OTTO</span>
        <p>{props.message}</p>
      </div>
    </div>
  );
}

function SummaryGrid(props: { dashboard: DashboardData }): React.JSX.Element {
  const { dashboard } = props;
  const items = [
    { label: "Runs", value: dashboard.runCounts.total },
    { label: "Active", value: dashboard.runCounts.active },
    { label: "Tickets", value: dashboard.ticketsCount },
    { label: "Runner", value: dashboard.defaultRunnerId || "n/a" },
  ];

  return (
    <div className="summary-grid summary-grid-compact">
      {items.map((item) => (
        <article key={item.label}>
          <p className="eyebrow">{item.label}</p>
          <div className="metric mono" style={item.label === "Runner" ? { fontSize: 18 } : undefined}>
            {item.value}
          </div>
        </article>
      ))}
    </div>
  );
}

function JobList(props: { state: AppState }): React.JSX.Element | null {
  const activeJobs = getActiveJobs(props.state.controlPlane);
  const visibleJobs = activeJobs.length > 0 ? activeJobs : (props.state.controlPlane?.jobs || []).slice(0, 3);
  if (visibleJobs.length === 0) return null;

  return (
    <CollapsibleCard title="Jobs" subtitle="Server-managed workflow activity across concurrent Otto runs.">
      <div className="ticket-list">
        {visibleJobs.map((job) => (
          <div className="ticket-row" key={job.id}>
            <div>
              <strong>{job.kind}</strong> <span className="mono">{job.runId}</span>
              {job.error ? <p className="footer-note">{job.error}</p> : null}
            </div>
            <div className="badge-row">
              <span className={`badge ${statusBadgeClass(job.status)}`}>{job.status}</span>
              <span className="badge mono">{formatDate(job.startedAt)}</span>
            </div>
          </div>
        ))}
      </div>
    </CollapsibleCard>
  );
}

export function PromptInbox(props: {
  prompts: ControlPlanePrompt[];
  promptDrafts: Record<string, string>;
  onDraftChange: (id: string, value: string) => void;
  onRespond: (id: string, value: boolean | string) => void;
}): React.JSX.Element | null {
  if (props.prompts.length === 0) return null;

  return (
    <div className="panel stack prompt-panel">
      <div>
        <p className="eyebrow">Prompt Inbox</p>
        <p className="subtle">The server is waiting on input for {props.prompts.length} prompt{props.prompts.length === 1 ? "" : "s"}.</p>
      </div>
      <div className="prompt-list">
        {props.prompts.map((prompt) => (
          <div className="prompt-card" key={prompt.id}>
            <div className="detail-topline">
              <div>
                <p className="eyebrow">{prompt.kind}</p>
                <p className="subtle">Run <span className="mono">{prompt.runId}</span></p>
              </div>
              <span className="badge mono">{formatDate(prompt.createdAt)}</span>
            </div>
            <pre className="prompt-message">{prompt.message}</pre>
            {prompt.kind === "confirm" ? (
              <div className="prompt-actions">
                <button className="button button-primary" onClick={() => props.onRespond(prompt.id, true)}>Confirm</button>
                <button className="button" onClick={() => props.onRespond(prompt.id, false)}>Cancel</button>
              </div>
            ) : null}
            {prompt.kind === "select" ? (
              <div className="prompt-actions">
                {(prompt.choices || []).map((choice) => (
                  <button className="button" key={choice} onClick={() => props.onRespond(prompt.id, choice)}>{choice}</button>
                ))}
              </div>
            ) : null}
            {prompt.kind === "text" ? (
              <>
                <textarea
                  className="text-input"
                  rows={6}
                  value={getPromptDraft(props.promptDrafts, prompt)}
                  onChange={(event) => props.onDraftChange(prompt.id, event.target.value)}
                />
                <div className="prompt-actions">
                  <button className="button button-primary" onClick={() => props.onRespond(prompt.id, getPromptDraft(props.promptDrafts, prompt))}>Submit response</button>
                </div>
              </>
            ) : null}
          </div>
        ))}
      </div>
    </div>
  );
}

export function AgUiFeed(props: { runId: string; events: AgUiEvent[] }): React.JSX.Element {
  const split = splitAgUiEvents(props.events);
  const timelineItems = buildAgUiTimeline(props.runId, split.primary);
  const debugEvents = split.debug;

  return (
    <article className="timeline-card">
      <p className="eyebrow">AG-UI</p>
      <h3>Run narrative</h3>
      {timelineItems.length > 0 ? (
        <div className="timeline-story">
          {[...timelineItems].reverse().map((item, index) => {
            const kind = item.status === "attention"
              ? "error"
              : item.kind === "message"
                ? "message"
                : item.kind === "tool"
                  ? "tool"
                  : item.kind === "reasoning"
                    ? "reasoning"
                    : item.kind === "control"
                      ? "control"
                      : "neutral";
            return (
              <div className={`timeline-entry ag-ui-card ag-ui-card-${kind}`} key={`${item.timestamp || index}-${item.title}-${index}`}>
                <div className="timeline-entry-marker"><NarrativeIcon item={item} /></div>
                <div className="timeline-entry-body">
                  <div className="timeline-entry-header">
                    <strong className="timeline-entry-title">{item.title}</strong>
                    <div className="timeline-entry-meta">
                      {item.meta ? <span>{item.meta}</span> : null}
                      <span className="mono">{item.timestamp ? formatDate(item.timestamp) : "-"}</span>
                    </div>
                  </div>
                  {item.body ? <div className="timeline-entry-text">{item.body}</div> : null}
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        <p className="subtle">No AG-UI events captured yet for this run.</p>
      )}
      {debugEvents.length > 0 ? (
        <details className="collapsible-card" style={{ marginTop: 12 }}>
          <summary className="collapsible-summary">
            <div>
              <p className="eyebrow">Debug</p>
              <p className="debug-summary">{debugEvents.length} raw or low-level command events hidden from the main feed</p>
            </div>
            <span className="badge mono collapsible-badge">toggle</span>
          </summary>
          <div className="prompt-list collapsible-body">
            {[...debugEvents].reverse().map((event, index) => {
              const summary = summarizeAgUiEvent(props.runId, event);
              return (
                <div className="prompt-card ag-ui-card ag-ui-card-raw" key={`debug-${event.timestamp || index}-${event.type}-${index}`}>
                  <div className="detail-topline">
                    <div>
                      <p className="eyebrow">{event.type || "EVENT"}</p>
                      <p className="subtle">{summary.title}</p>
                    </div>
                    <span className="badge mono">{event.timestamp ? formatDate(event.timestamp) : "-"}</span>
                  </div>
                  {summary.body ? <pre className="prompt-message">{summary.body}</pre> : <p className="footer-note">No body payload.</p>}
                </div>
              );
            })}
          </div>
        </details>
      ) : null}
    </article>
  );
}

function SidebarRunItem(props: { run: DashboardRunSummary; selectedRunId: string | null; onSelectRun: (runId: string) => void }): React.JSX.Element {
  const { run } = props;
  const status = run.isMarkedDone ? "done" : run.processStatus;
  return (
    <button className={`run-row${run.runId === props.selectedRunId ? " active" : ""}`} onClick={() => props.onSelectRun(run.runId)}>
      <div className="run-row-title">
        <strong>{run.ticketSlug || run.runId}</strong>
        <span className={`badge ${statusBadgeClass(status)}`}>{status}</span>
      </div>
      <p className="subtle mono">{run.runId}</p>
      <div className="badge-row">
        <span className="badge">{run.phase || "unknown"}</span>
        <span className="badge">queue {run.taskQueueLength}</span>
        {run.needsUserInput ? <span className="badge waiting">waiting</span> : null}
      </div>
    </button>
  );
}

function Sidebar(props: {
  state: AppState;
  onRefresh: () => void;
  onCreateTicket: () => void;
  onIngestTicket: () => void;
  onTicketDraftChange: (value: string) => void;
  onIngestDraftChange: (value: string) => void;
  onIngestSourceNameChange: (value: string) => void;
  onIngestFile: (file: File) => void;
  onStartRun: (ticketId: string) => void;
  onSelectRun: (runId: string) => void;
}): React.JSX.Element {
  const dashboard = props.state.dashboard as DashboardData;
  return (
    <aside className="sidebar">
      <div className="stack sidebar-stack">
        <section className="hero-card">
          <div className="hero-topline">
            <span className="wordmark">OTTO WEB</span>
            <span className={`badge ${statusBadgeClass(props.state.liveStreamStatus)}`}>stream {props.state.liveStreamStatus}</span>
          </div>
          <h1 className="title hero-title">Control plane</h1>
          <p className="subtle hero-copy">Monitor active workflows, inspect AG-UI event streams, and steer Otto without living in the terminal.</p>
          <SummaryGrid dashboard={dashboard} />
        </section>

        <CollapsibleCard title="Repository" subtitle={dashboard.repoPath}>
          <div className="toolbar">
            <div>
              <p className="subtle">Config</p>
              <p className="mono repo-path">{dashboard.configPath}</p>
            </div>
            <button className="button" onClick={props.onRefresh}>Refresh</button>
          </div>
          <div className="detail-badges">
            <span className="badge">onboarding {dashboard.onboardingStatus || "missing"}</span>
            <span className="badge">subagents {dashboard.subagentsEnabled ? "enabled" : "disabled"}</span>
          </div>
        </CollapsibleCard>

        <JobList state={props.state} />

        <CollapsibleCard title="Create ticket" subtitle="Spin up new work directly from the browser.">
          <textarea className="text-input" rows={5} value={props.state.ticketDraft} onChange={(event) => props.onTicketDraftChange(event.target.value)} placeholder="Describe the work you want Otto to tackle." />
          <button className="button button-primary" disabled={props.state.isCreatingTicket} onClick={props.onCreateTicket}>{props.state.isCreatingTicket ? "Creating..." : "Create ticket"}</button>
        </CollapsibleCard>

        <CollapsibleCard title="Ingest external ticket" subtitle="Paste or upload markdown and normalize it into Otto’s ticket model.">
          <input className="file-input" type="file" disabled={props.state.isIngestingTicket} onChange={(event) => { const file = event.target.files?.[0]; if (file) props.onIngestFile(file); }} />
          <input className="text-line-input mono" type="text" value={props.state.ingestSourceName} disabled={props.state.isIngestingTicket} onChange={(event) => props.onIngestSourceNameChange(event.target.value)} />
          <textarea className="text-input" rows={7} value={props.state.ingestDraft} onChange={(event) => props.onIngestDraftChange(event.target.value)} placeholder="# Imported ticket&#10;&#10;Paste or type external ticket content here." />
          <button className="button button-primary" disabled={props.state.isIngestingTicket} onClick={props.onIngestTicket}>{props.state.isIngestingTicket ? "Ingesting..." : "Ingest external ticket"}</button>
        </CollapsibleCard>

        <CollapsibleCard title="Ticket inventory" subtitle="Start browser-driven runs directly from the managed queue.">
          <div className="ticket-list">
            {dashboard.tickets.map((ticket) => (
              <div className="ticket-row" key={ticket.ticketId}>
                <div><strong className="mono">{ticket.ticketId}</strong></div>
                {ticket.hasRun ? <span className="badge">started</span> : <button className="button button-secondary" disabled={isRunBusy(props.state.controlPlane, ticket.ticketId)} onClick={() => props.onStartRun(ticket.ticketId)}>Start</button>}
              </div>
            ))}
          </div>
        </CollapsibleCard>
      </div>

      <CollapsibleCard title="Runs" subtitle="Active and historical workflow sessions." defaultOpen>
        <div className="runs-list">
          {dashboard.runs.map((run) => (
            <SidebarRunItem key={run.runId} run={run} selectedRunId={props.state.selectedRunId} onSelectRun={props.onSelectRun} />
          ))}
        </div>
      </CollapsibleCard>
    </aside>
  );
}

function ArtifactList(props: { artifacts: RunArtifact[] }): React.JSX.Element {
  return (
    <div className="artifact-grid">
      {props.artifacts.map((artifact) => (
        <details className="artifact-card collapsible-card" key={artifact.id}>
          <summary className="collapsible-summary">
            <div>
              <p className="eyebrow">Artifact</p>
              <h3>{artifact.title}</h3>
            </div>
            <div className="detail-badges">
              <span className="badge mono">{artifact.language}</span>
              {artifact.truncated ? <span className="badge">truncated</span> : null}
            </div>
          </summary>
          <div className="stack collapsible-body">
            <p className="footer-note mono">{artifact.path}</p>
            {artifact.exists ? <pre>{artifact.content || ""}</pre> : <p className="subtle">Not present yet.</p>}
          </div>
        </details>
      ))}
    </div>
  );
}

function RunDetail(props: {
  state: AppState;
  detail: RunDetailData | null;
  onResumeRun: (runId: string) => void;
  onMergeBackRun: (runId: string) => void;
  onDeleteRun: (runId: string) => void;
  onToggleDone: (runId: string, markedDone: boolean) => void;
}): React.JSX.Element {
  if (!props.detail) {
    return <div className="empty-state"><div><span className="wordmark">OTTO</span><p>Select a run to inspect its artifacts and telemetry.</p></div></div>;
  }

  const selected = props.detail;
  const agUiEvents = props.state.agUiEventsByRun[selected.summary.runId] || [];
  const busy = isRunBusy(props.state.controlPlane, selected.summary.runId);
  const status = selected.summary.isMarkedDone ? "done" : selected.summary.processStatus;

  return (
    <div className="stack">
      <section className="header-block">
        <div className="toolbar detail-header">
          <div style={{ minWidth: 0 }}>
            <p className="eyebrow">Run detail</p>
            <h1 className="title detail-title">{selected.summary.ticketSlug || selected.summary.runId}</h1>
            <p className="subtle mono">{selected.summary.runId}</p>
          </div>
          <div className="detail-actions">
            <div className="detail-badges">
              <span className={`badge ${statusBadgeClass(status)}`}>{status}</span>
              <span className="badge">phase {selected.summary.phase || "unknown"}</span>
              {selected.summary.needsUserInput ? <span className="badge waiting">awaiting input</span> : null}
            </div>
            <div className="prompt-actions">
              {selected.summary.processStatus !== "active" && !selected.summary.isMarkedDone ? <button className="button button-primary" disabled={busy} onClick={() => props.onResumeRun(selected.summary.runId)}>Resume</button> : null}
              {selected.summary.processStatus !== "active" && selected.summary.finalReportAvailable ? <button className="button button-secondary" disabled={busy} onClick={() => props.onMergeBackRun(selected.summary.runId)}>Merge back</button> : null}
              {selected.summary.processStatus !== "active" ? <button className="button button-secondary" disabled={busy} onClick={() => props.onToggleDone(selected.summary.runId, !selected.summary.isMarkedDone)}>{selected.summary.isMarkedDone ? "Undo done" : "Mark done"}</button> : null}
              <button className="button button-danger" disabled={props.state.isDeletingRun || busy} onClick={() => props.onDeleteRun(selected.summary.runId)}>{props.state.isDeletingRun ? "Deleting..." : "Delete run"}</button>
            </div>
          </div>
        </div>
        <RunProgressStrip phase={selected.summary.phase} />
        <RunDetailStats detail={selected} />
      </section>
      <section className="grid-two">
        <ArtifactList artifacts={selected.artifacts} />
        <div className="timeline-grid">
          <AgUiFeed runId={selected.summary.runId} events={agUiEvents} />
          <article className="timeline-card">
            <p className="eyebrow">Timeline</p>
            <h3>Run events</h3>
            {selected.recentEvents.length > 0 ? (
              <pre>
                {selected.recentEvents
                  .map((entry) => `[${entry.at}] ${entry.type}${entry.data ? `\n${JSON.stringify(entry.data, null, 2)}` : ""}`)
                  .join("\n\n")}
              </pre>
            ) : (
              <p className="subtle">No entries yet.</p>
            )}
          </article>
          <article className="timeline-card">
            <p className="eyebrow">Timeline</p>
            <h3>Exec events</h3>
            {selected.recentExecs.length > 0 ? (
              <pre>
                {selected.recentExecs
                  .map((entry) => `[${entry.at}] ${entry.label} exit=${entry.exitCode} timedOut=${entry.timedOut} durationMs=${entry.durationMs}`)
                  .join("\n\n")}
              </pre>
            ) : (
              <p className="subtle">No entries yet.</p>
            )}
          </article>
        </div>
      </section>
    </div>
  );
}

export function AppLayout(props: {
  state: AppState;
  selectedDetail: RunDetailData | null;
  onSetViewMode: (viewMode: "overview" | "details") => void;
  overviewPanel: OverviewPanel;
  onSetOverviewPanel: (panel: OverviewPanel) => void;
  onProjectStateDraftChange: (value: string) => void;
  onSaveProjectState: () => void;
  onSelectRun: (runId: string) => void;
  onRefresh: () => void;
  onCreateTicket: () => void;
  onIngestTicket: () => void;
  onTicketDraftChange: (value: string) => void;
  onIngestDraftChange: (value: string) => void;
  onIngestSourceNameChange: (value: string) => void;
  onIngestFile: (file: File) => void;
  onStartRun: (ticketId: string) => void;
  onRespondPrompt: (id: string, value: boolean | string) => void;
  onPromptDraftChange: (id: string, value: string) => void;
  onResumeRun: (runId: string) => void;
  onMergeBackRun: (runId: string) => void;
  onDeleteRun: (runId: string) => void;
  onToggleDone: (runId: string, markedDone: boolean) => void;
}): React.JSX.Element {
  return (
    <div className={`app-shell ${props.state.viewMode === "overview" ? "app-shell-overview" : "app-shell-details"}`}>
      {props.state.viewMode === "details" ? (
        <Sidebar
          state={props.state}
          onRefresh={props.onRefresh}
          onCreateTicket={props.onCreateTicket}
          onIngestTicket={props.onIngestTicket}
          onTicketDraftChange={props.onTicketDraftChange}
          onIngestDraftChange={props.onIngestDraftChange}
          onIngestSourceNameChange={props.onIngestSourceNameChange}
          onIngestFile={props.onIngestFile}
          onStartRun={props.onStartRun}
          onSelectRun={props.onSelectRun}
        />
      ) : null}
      <main className="main">
        <div className="view-toggle-bar">
          <div className="prompt-actions">
            <button className={`button ${props.state.viewMode === "overview" ? "button-primary" : "button-secondary"}`} onClick={() => props.onSetViewMode("overview")}>Overview</button>
            <button className={`button ${props.state.viewMode === "details" ? "button-primary" : "button-secondary"}`} onClick={() => props.onSetViewMode("details")}>Details</button>
          </div>
        </div>
        {props.state.viewMode === "details" ? <PromptInbox prompts={props.state.controlPlane?.prompts || []} promptDrafts={props.state.promptDrafts} onDraftChange={props.onPromptDraftChange} onRespond={props.onRespondPrompt} /> : null}
        {props.state.actionError ? <div className="action-banner error">{props.state.actionError}</div> : null}
        {props.state.actionMessage ? <div className="action-banner success">{props.state.actionMessage}</div> : null}
        {props.state.viewMode === "overview" ? (
          <ProjectOverview
            state={props.state}
            selectedDetail={props.selectedDetail}
            overviewPanel={props.overviewPanel}
            onSetOverviewPanel={props.onSetOverviewPanel}
            onProjectStateDraftChange={props.onProjectStateDraftChange}
            onSaveProjectState={props.onSaveProjectState}
            onCreateTicket={props.onCreateTicket}
            onIngestTicket={props.onIngestTicket}
            onTicketDraftChange={props.onTicketDraftChange}
            onIngestDraftChange={props.onIngestDraftChange}
            onIngestSourceNameChange={props.onIngestSourceNameChange}
            onIngestFile={props.onIngestFile}
            onStartRun={props.onStartRun}
            onSelectRun={props.onSelectRun}
            onPromptDraftChange={props.onPromptDraftChange}
            onRespondPrompt={props.onRespondPrompt}
          />
        ) : (
          <RunDetail state={props.state} detail={props.selectedDetail} onResumeRun={props.onResumeRun} onMergeBackRun={props.onMergeBackRun} onDeleteRun={props.onDeleteRun} onToggleDone={props.onToggleDone} />
        )}
      </main>
    </div>
  );
}
