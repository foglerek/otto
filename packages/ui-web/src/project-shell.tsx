import React from "react";

import { AgUiFeed, PromptInbox } from "./components.js";
import { compactRunStages, formatDate, presentStageName, statusBadgeClass } from "./helpers.js";
import type { AppState, DashboardData, DashboardRunSummary, RunDetailData } from "./types.js";

export type OverviewPanel = "create" | "ingest" | "start" | null;

function OverviewRunCard(props: {
  run: DashboardRunSummary;
  selected: boolean;
  onSelect: () => void;
}): React.JSX.Element {
  const status = props.run.isMarkedDone ? "done" : props.run.processStatus === "active" ? "running" : props.run.needsUserInput ? "paused" : props.run.processStatus;
  const stages = compactRunStages(props.run.phase);
  return (
    <button className={`overview-run-card${props.selected ? " active" : ""}`} onClick={props.onSelect}>
      <div className="overview-run-topline">
        <strong>{status}: {props.run.ticketSlug || props.run.runId}</strong>
      </div>
      <div className="stage-strip">
        <div className="stage-strip-node done">
          <span className="stage-dot" />
          <span className="stage-label">{presentStageName(stages.previous)}</span>
        </div>
        <div className={`stage-strip-node ${status === "paused" ? "waiting" : status === "stale" ? "stale" : status === "done" ? "done" : "active"}`}>
          <span className="stage-dot" />
          <span className="stage-label">{presentStageName(stages.current)}</span>
        </div>
        <div className="stage-strip-node">
          <span className="stage-dot" />
          <span className="stage-label">{presentStageName(stages.next)}</span>
        </div>
      </div>
    </button>
  );
}

function OverviewSidebar(props: {
  state: AppState;
  onSelectRun: (runId: string) => void;
}): React.JSX.Element {
  const dashboard = props.state.dashboard as DashboardData;
  const groups = [
    { title: "Running", runs: dashboard.runs.filter((run) => !run.isMarkedDone && run.processStatus === "active") },
    { title: "Paused", runs: dashboard.runs.filter((run) => !run.isMarkedDone && run.processStatus !== "active" && run.needsUserInput) },
    { title: "Errored", runs: dashboard.runs.filter((run) => !run.isMarkedDone && run.processStatus === "stale") },
    { title: "Done", runs: dashboard.runs.filter((run) => run.isMarkedDone || run.processStatus === "inactive") },
  ];

  return (
    <aside className="project-sidebar">
      {groups.map((group) => group.runs.length > 0 ? (
        <section className="project-run-group" key={group.title}>
          <p className="eyebrow">{group.title}</p>
          <div className="project-run-list">
            {group.runs.map((run) => (
              <OverviewRunCard key={run.runId} run={run} selected={run.runId === props.state.selectedRunId} onSelect={() => props.onSelectRun(run.runId)} />
            ))}
          </div>
        </section>
      ) : null)}
    </aside>
  );
}

function OverviewComposer(props: {
  state: AppState;
  selectedDetail: RunDetailData | null;
  onPromptDraftChange: (id: string, value: string) => void;
  onRespondPrompt: (id: string, value: boolean | string) => void;
}): React.JSX.Element {
  const prompts = (props.state.controlPlane?.prompts || []).filter((prompt) => prompt.runId === props.state.selectedRunId);
  if (prompts.length > 0) {
    return <PromptInbox prompts={prompts} promptDrafts={props.state.promptDrafts} onDraftChange={props.onPromptDraftChange} onRespond={props.onRespondPrompt} />;
  }

  if (!props.selectedDetail) {
    return <div className="project-empty"><p className="subtle">Select a run to inspect its latest activity.</p></div>;
  }

  return (
    <div className="project-chat-shell">
      <div className="project-chat-body">
        <p className="eyebrow">Current state</p>
        <h2 className="project-chat-title">{props.selectedDetail.summary.ticketSlug || props.selectedDetail.summary.runId}</h2>
        <p className="subtle">Phase: {props.selectedDetail.summary.phase || "unknown"} · Updated {formatDate(props.selectedDetail.summary.createdAt)}</p>
        <p className="project-chat-note">
          {props.selectedDetail.summary.needsUserInput
            ? `This run is waiting for input before it can continue.`
            : `No direct question is pending. Review the latest AG-UI story below or drill into details for artifacts and full telemetry.`}
        </p>
        <div className="project-inline-feed">
          <AgUiFeed runId={props.selectedDetail.summary.runId} events={props.state.agUiEventsByRun[props.selectedDetail.summary.runId] || []} />
        </div>
      </div>
      <div className="project-chat-inputRow">
        <div className="project-chat-inputPlaceholder">Direct replies will land here when the selected run asks for input.</div>
        <button className="button" disabled>Send</button>
      </div>
    </div>
  );
}

export function ProjectOverview(props: {
  state: AppState;
  selectedDetail: RunDetailData | null;
  overviewPanel: OverviewPanel;
  onSetOverviewPanel: (panel: OverviewPanel) => void;
  onCreateTicket: () => void;
  onIngestTicket: () => void;
  onTicketDraftChange: (value: string) => void;
  onIngestDraftChange: (value: string) => void;
  onIngestSourceNameChange: (value: string) => void;
  onIngestFile: (file: File) => void;
  onStartRun: (ticketId: string) => void;
  onSelectRun: (runId: string) => void;
  onPromptDraftChange: (id: string, value: string) => void;
  onRespondPrompt: (id: string, value: boolean | string) => void;
}): React.JSX.Element {
  return (
    <div className="stack">
      <div className="project-toolbar">
        <div className="prompt-actions">
          <button className={`button ${props.overviewPanel === "create" ? "button-primary" : "button-secondary"}`} onClick={() => props.onSetOverviewPanel(props.overviewPanel === "create" ? null : "create")}>Create ticket</button>
          <button className={`button ${props.overviewPanel === "ingest" ? "button-primary" : "button-secondary"}`} onClick={() => props.onSetOverviewPanel(props.overviewPanel === "ingest" ? null : "ingest")}>Ingest ticket</button>
          <button className={`button ${props.overviewPanel === "start" ? "button-primary" : "button-secondary"}`} onClick={() => props.onSetOverviewPanel(props.overviewPanel === "start" ? null : "start")}>Start run</button>
        </div>
      </div>
      {props.overviewPanel === "create" ? <div className="panel stack"><p className="eyebrow">Create ticket</p><textarea className="text-input" rows={5} value={props.state.ticketDraft} onChange={(event) => props.onTicketDraftChange(event.target.value)} placeholder="Describe the work you want Otto to tackle." /><button className="button button-primary" disabled={props.state.isCreatingTicket} onClick={props.onCreateTicket}>{props.state.isCreatingTicket ? "Creating..." : "Create ticket"}</button></div> : null}
      {props.overviewPanel === "ingest" ? <div className="panel stack"><p className="eyebrow">Ingest external ticket</p><input className="file-input" type="file" disabled={props.state.isIngestingTicket} onChange={(event) => { const file = event.target.files?.[0]; if (file) props.onIngestFile(file); }} /><input className="text-line-input mono" type="text" value={props.state.ingestSourceName} disabled={props.state.isIngestingTicket} onChange={(event) => props.onIngestSourceNameChange(event.target.value)} /><textarea className="text-input" rows={7} value={props.state.ingestDraft} onChange={(event) => props.onIngestDraftChange(event.target.value)} placeholder="# Imported ticket&#10;&#10;Paste or type external ticket content here." /><button className="button button-primary" disabled={props.state.isIngestingTicket} onClick={props.onIngestTicket}>{props.state.isIngestingTicket ? "Ingesting..." : "Ingest external ticket"}</button></div> : null}
      {props.overviewPanel === "start" ? <div className="panel stack"><p className="eyebrow">Start run</p><div className="ticket-list">{(props.state.dashboard?.tickets || []).map((ticket) => <div className="ticket-row" key={ticket.ticketId}><div><strong className="mono">{ticket.ticketId}</strong></div>{ticket.hasRun ? <span className="badge">started</span> : <button className="button button-secondary" onClick={() => props.onStartRun(ticket.ticketId)}>Start</button>}</div>)}</div></div> : null}
      <div className="project-shell">
        <OverviewSidebar state={props.state} onSelectRun={props.onSelectRun} />
        <section className="project-main">
          <OverviewComposer
            state={props.state}
            selectedDetail={props.selectedDetail}
          onPromptDraftChange={props.onPromptDraftChange}
          onRespondPrompt={props.onRespondPrompt}
          />
        </section>
      </div>
    </div>
  );
}
