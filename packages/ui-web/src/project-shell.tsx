import React from "react";

import { PromptInbox } from "./components.js";
import { buildAgUiTimeline, splitAgUiEvents } from "./ag-ui-timeline.js";
import { compactRunStages, formatDate, getRunDisplayStatus, getRunStatusNote, presentStageName, statusBadgeClass } from "./helpers.js";
import type { AppState, DashboardData, DashboardRunSummary, RunDetailData } from "./types.js";

export type OverviewPanel = "create" | "ingest" | "start" | null;

function OverviewRunCard(props: {
  run: DashboardRunSummary;
  selected: boolean;
  onSelect: () => void;
}): React.JSX.Element {
  const status = getRunDisplayStatus(props.run);
  const stages = compactRunStages(props.run.phase);
  return (
    <button className={`overview-run-card${props.selected ? " active" : ""}`} onClick={props.onSelect}>
      <div className="overview-run-header">
        <div className="stack" style={{ gap: 6 }}>
          <p className="eyebrow">{status}</p>
          <strong className="overview-run-title">{props.run.ticketSlug || props.run.runId}</strong>
        </div>
        <span className={`badge ${statusBadgeClass(status)}`}>{status}</span>
      </div>
      <p className="overview-run-note">{getRunStatusNote(props.run)}</p>
      <div className="overview-run-meta">
        <span className="badge">phase {presentStageName(props.run.phase)}</span>
        <span className="badge">queue {props.run.taskQueueLength}</span>
        {props.run.finalReportAvailable ? <span className="badge">report ready</span> : null}
        {props.run.needsUserInput ? <span className="badge waiting">prompt waiting</span> : null}
      </div>
      <div className="stage-strip">
        <div className={`stage-strip-node ${status === "running" || status === "paused" || status === "errored" || status === "done" ? "done" : ""}`}>
          <span className="stage-dot" />
          <span className="stage-kicker">Previous</span>
          <span className="stage-label">{presentStageName(stages.previous)}</span>
        </div>
        <div className={`stage-strip-node ${status === "paused" ? "waiting" : status === "errored" ? "stale" : status === "done" ? "done" : "active"}`}>
          <span className="stage-dot" />
          <span className="stage-kicker">Now</span>
          <span className="stage-label">{presentStageName(stages.current)}</span>
        </div>
        <div className="stage-strip-node">
          <span className="stage-dot" />
          <span className="stage-kicker">Next</span>
          <span className="stage-label">{presentStageName(stages.next)}</span>
        </div>
      </div>
      <p className="overview-run-footer mono">{props.run.runId}</p>
    </button>
  );
}

function OverviewSidebar(props: {
  state: AppState;
  onSelectRun: (runId: string) => void;
}): React.JSX.Element {
  const dashboard = props.state.dashboard as DashboardData;
  const groups = [
    { title: "Running", runs: dashboard.runs.filter((run) => getRunDisplayStatus(run) === "running") },
    { title: "Paused", runs: dashboard.runs.filter((run) => getRunDisplayStatus(run) === "paused") },
    { title: "Errored", runs: dashboard.runs.filter((run) => getRunDisplayStatus(run) === "errored") },
    { title: "Done", runs: dashboard.runs.filter((run) => getRunDisplayStatus(run) === "done") },
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

function OverviewStory(props: {
  run: DashboardRunSummary;
  state: AppState;
}): React.JSX.Element {
  const events = props.state.agUiEventsByRun[props.run.runId] || [];
  const timeline = buildAgUiTimeline(props.run.runId, splitAgUiEvents(events).primary);

  if (timeline.length === 0) {
    return (
      <div className="project-story-empty">
        <p className="eyebrow">Story</p>
        <h3 className="project-section-title">No story yet</h3>
        <p className="subtle">This run has not emitted grouped AG-UI events yet. Resume it or switch to details for raw artifacts and event logs.</p>
      </div>
    );
  }

  return (
    <div className="project-story-list">
      {[...timeline].reverse().map((item, index) => (
        <article className={`project-story-card ${item.status ? `project-story-${item.status}` : ""}`} key={`${item.timestamp || index}-${item.title}-${index}`}>
          <div className="project-story-marker" />
          <div className="project-story-content">
            <div className="project-story-header">
              <h3 className="project-story-title">{item.title}</h3>
              <div className="project-story-meta">
                {item.meta ? <span>{item.meta}</span> : null}
                <span className="mono">{item.timestamp ? formatDate(item.timestamp) : "-"}</span>
              </div>
            </div>
            {item.body ? <div className="project-story-body">{item.body}</div> : null}
          </div>
        </article>
      ))}
    </div>
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
    return (
      <div className="project-chat-shell">
        <div className="project-chat-header">
          <div>
            <p className="eyebrow">Current ask</p>
            <h2 className="project-chat-title">{props.selectedDetail?.summary.ticketSlug || props.selectedDetail?.summary.runId || "Selected run"}</h2>
            <p className="project-chat-note">The selected run is waiting on input. Respond here to unblock it.</p>
          </div>
          {props.selectedDetail ? <span className={`badge ${statusBadgeClass(getRunDisplayStatus(props.selectedDetail.summary))}`}>{getRunDisplayStatus(props.selectedDetail.summary)}</span> : null}
        </div>
        <div className="project-chat-body">
          <PromptInbox prompts={prompts} promptDrafts={props.state.promptDrafts} onDraftChange={props.onPromptDraftChange} onRespond={props.onRespondPrompt} />
        </div>
      </div>
    );
  }

  if (!props.selectedDetail) {
    return <div className="project-empty"><p className="subtle">Select a run to inspect its latest activity.</p></div>;
  }

  return (
    <div className="project-chat-shell">
      <div className="project-chat-header">
        <div>
          <p className="eyebrow">Selected run</p>
          <h2 className="project-chat-title">{props.selectedDetail.summary.ticketSlug || props.selectedDetail.summary.runId}</h2>
          <p className="subtle">Phase: {presentStageName(props.selectedDetail.summary.phase)} · Started {formatDate(props.selectedDetail.summary.createdAt)}</p>
        </div>
        <div className="project-chat-statuses">
          <span className={`badge ${statusBadgeClass(getRunDisplayStatus(props.selectedDetail.summary))}`}>{getRunDisplayStatus(props.selectedDetail.summary)}</span>
          <span className="badge mono">{props.selectedDetail.summary.branchName}</span>
        </div>
      </div>
      <div className="project-chat-body">
        <p className="project-chat-note">{getRunStatusNote(props.selectedDetail.summary)}</p>
        <div className="project-story-shell">
          <div className="project-story-topline">
            <div>
              <p className="eyebrow">Story</p>
              <h3 className="project-section-title">Latest narrative</h3>
            </div>
            <div className="badge-row">
              {props.selectedDetail.summary.finalReportAvailable ? <span className="badge">report ready</span> : null}
              {props.selectedDetail.summary.needsUserInput ? <span className="badge waiting">awaiting input</span> : null}
            </div>
          </div>
          <OverviewStory run={props.selectedDetail.summary} state={props.state} />
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
  onProjectStateDraftChange: (value: string) => void;
  onSaveProjectState: () => void;
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
      <div className="panel stack">
        <div className="toolbar">
          <div>
            <p className="eyebrow">Project state</p>
            <p className="subtle mono">{props.state.dashboard?.projectState.path || ""}</p>
          </div>
          <button className="button button-primary" disabled={props.state.isSavingProjectState} onClick={props.onSaveProjectState}>{props.state.isSavingProjectState ? "Saving..." : "Save state"}</button>
        </div>
        <textarea className="text-input" rows={6} value={props.state.projectStateDraft} onChange={(event) => props.onProjectStateDraftChange(event.target.value)} />
      </div>
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
