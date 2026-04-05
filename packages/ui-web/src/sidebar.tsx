import React from "react";

import { CollapsibleCard } from "./disclosure.js";
import { formatDate, getActiveJobs, isRunBusy, statusBadgeClass } from "./helpers.js";
import type { AppState, DashboardData, DashboardRunSummary } from "./types.js";

function SummaryGrid(props: { dashboard: DashboardData }): React.JSX.Element {
  const items = [
    { label: "Runs", value: props.dashboard.runCounts.total },
    { label: "Active", value: props.dashboard.runCounts.active },
    { label: "Tickets", value: props.dashboard.ticketsCount },
    { label: "Runner", value: props.dashboard.defaultRunnerId || "n/a" },
  ];
  return <div className="summary-grid summary-grid-compact">{items.map((item) => <article key={item.label}><p className="eyebrow">{item.label}</p><div className="metric mono" style={item.label === "Runner" ? { fontSize: 18 } : undefined}>{item.value}</div></article>)}</div>;
}

function JobList(props: { state: AppState }): React.JSX.Element | null {
  const activeJobs = getActiveJobs(props.state.controlPlane);
  const visibleJobs = activeJobs.length > 0 ? activeJobs : (props.state.controlPlane?.jobs || []).slice(0, 3);
  if (visibleJobs.length === 0) return null;
  return <CollapsibleCard title="Jobs" subtitle="Server-managed workflow activity across concurrent Otto runs."><div className="ticket-list">{visibleJobs.map((job) => <div className="ticket-row" key={job.id}><div><strong>{job.kind}</strong> <span className="mono">{job.runId}</span>{job.error ? <p className="footer-note">{job.error}</p> : null}</div><div className="badge-row"><span className={`badge ${statusBadgeClass(job.status)}`}>{job.status}</span><span className="badge mono">{formatDate(job.startedAt)}</span></div></div>)}</div></CollapsibleCard>;
}

function SidebarRunItem(props: { run: DashboardRunSummary; selectedRunId: string | null; onSelectRun: (runId: string) => void }): React.JSX.Element {
  const status = props.run.isMarkedDone ? "done" : props.run.processStatus;
  return <button className={`run-row${props.run.runId === props.selectedRunId ? " active" : ""}`} onClick={() => props.onSelectRun(props.run.runId)}><div className="run-row-title"><strong>{props.run.ticketSlug || props.run.runId}</strong><span className={`badge ${statusBadgeClass(status)}`}>{status}</span></div><p className="subtle mono">{props.run.runId}</p><div className="badge-row"><span className="badge">{props.run.phase || "unknown"}</span><span className="badge">queue {props.run.taskQueueLength}</span>{props.run.needsUserInput ? <span className="badge waiting">waiting</span> : null}</div></button>;
}

export function Sidebar(props: {
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
  return <aside className="sidebar"><div className="stack sidebar-stack"><section className="hero-card"><div className="hero-topline"><span className="wordmark">OTTO WEB</span><span className={`badge ${statusBadgeClass(props.state.liveStreamStatus)}`}>stream {props.state.liveStreamStatus}</span></div><h1 className="title hero-title">Control plane</h1><p className="subtle hero-copy">Monitor active workflows, inspect AG-UI event streams, and steer Otto without living in the terminal.</p><SummaryGrid dashboard={dashboard} /></section><CollapsibleCard title="Repository" subtitle={dashboard.repoPath}><div className="toolbar"><div><p className="subtle">Config</p><p className="mono repo-path">{dashboard.configPath}</p></div><button className="button" onClick={props.onRefresh}>Refresh</button></div><div className="detail-badges"><span className="badge">onboarding {dashboard.onboardingStatus || "missing"}</span><span className="badge">subagents {dashboard.subagentsEnabled ? "enabled" : "disabled"}</span></div></CollapsibleCard><JobList state={props.state} /><CollapsibleCard title="Create ticket" subtitle="Spin up new work directly from the browser."><textarea className="text-input" rows={5} value={props.state.ticketDraft} onChange={(event) => props.onTicketDraftChange(event.target.value)} placeholder="Describe the work you want Otto to tackle." /><button className="button button-primary" disabled={props.state.isCreatingTicket} onClick={props.onCreateTicket}>{props.state.isCreatingTicket ? "Creating..." : "Create ticket"}</button></CollapsibleCard><CollapsibleCard title="Ingest external ticket" subtitle="Paste or upload markdown and normalize it into Otto’s ticket model."><input className="file-input" type="file" disabled={props.state.isIngestingTicket} onChange={(event) => { const file = event.target.files?.[0]; if (file) props.onIngestFile(file); }} /><input className="text-line-input mono" type="text" value={props.state.ingestSourceName} disabled={props.state.isIngestingTicket} onChange={(event) => props.onIngestSourceNameChange(event.target.value)} /><textarea className="text-input" rows={7} value={props.state.ingestDraft} onChange={(event) => props.onIngestDraftChange(event.target.value)} placeholder="# Imported ticket&#10;&#10;Paste or type external ticket content here." /><button className="button button-primary" disabled={props.state.isIngestingTicket} onClick={props.onIngestTicket}>{props.state.isIngestingTicket ? "Ingesting..." : "Ingest external ticket"}</button></CollapsibleCard><CollapsibleCard title="Ticket inventory" subtitle="Start browser-driven runs directly from the managed queue."><div className="ticket-list">{dashboard.tickets.map((ticket) => <div className="ticket-row" key={ticket.ticketId}><div><strong className="mono">{ticket.ticketId}</strong></div>{ticket.hasRun ? <span className="badge">started</span> : <button className="button button-secondary" disabled={isRunBusy(props.state.controlPlane, ticket.ticketId)} onClick={() => props.onStartRun(ticket.ticketId)}>Start</button>}</div>)}</div></CollapsibleCard></div><CollapsibleCard title="Runs" subtitle="Active and historical workflow sessions." defaultOpen><div className="runs-list">{dashboard.runs.map((run) => <SidebarRunItem key={run.runId} run={run} selectedRunId={props.state.selectedRunId} onSelectRun={props.onSelectRun} />)}</div></CollapsibleCard></aside>;
}
