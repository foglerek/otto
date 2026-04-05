export const UI_WEB_APP_SCRIPT_FRAGMENT_1 = `const state = {
  dashboard: null,
  controlPlane: null,
  selectedRunId: null,
  detailCache: new Map(),
  agUiEventsByRun: {},
  ticketDraft: "",
  ingestDraft: "",
  ingestSourceName: "browser-ingest.md",
  promptDrafts: {},
  actionMessage: "",
  actionError: "",
  isCreatingTicket: false,
  isIngestingTicket: false,
  isDeletingRun: false,
  liveStreamStatus: "connecting",
};

let liveEventSource = null;
let liveStreamRunId = null;
let agUiEventSource = null;
let agUiRunId = null;

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

async function fetchJson(url, options) {
  const response = await fetch(url, {
    headers: { accept: "application/json" },
    ...(options || {}),
  });
  if (!response.ok) {
    let message = "Request failed: " + response.status;
    try {
      const data = await response.json();
      if (data && typeof data.error === "string") {
        message = data.error;
      }
    } catch {
      const text = await response.text();
      if (text) {
        message = text;
      }
    }
    throw new Error(message);
  }
  return await response.json();
}

function formatDate(value) {
  if (!value) return "-";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
}

function statusBadge(status) {
  const cls = status === "active" ? "active" : status === "stale" ? "stale" : "done";
  return '<span class="badge ' + cls + '">' + escapeHtml(status) + '</span>';
}

function ensureSelectedRun() {
  const runs = state.dashboard?.runs ?? [];
  if (runs.length === 0) {
    state.selectedRunId = null;
    return;
  }
  const exists = runs.some((run) => run.runId === state.selectedRunId);
  if (!exists) {
    state.selectedRunId = runs[0].runId;
  }
}

function getActiveJobs() {
  const jobs = state.controlPlane?.jobs ?? [];
  return jobs.filter((job) => job.status === 'running' || job.status === 'waiting');
}

function isRunBusy(runId) {
  return getActiveJobs().some((job) => job.runId === runId);
}

function getPromptList() {
  return state.controlPlane?.prompts ?? [];
}

function getPromptDraft(prompt) {
  const draft = state.promptDrafts[prompt.id];
  if (typeof draft === 'string') {
    return draft;
  }
  return typeof prompt.defaultValue === 'string' ? prompt.defaultValue : '';
}

function clearActionState() {
  state.actionMessage = "";
  state.actionError = "";
}

function getAgUiEvents(runId) {
  return state.agUiEventsByRun[runId] || [];
}

function truncateText(value, maxChars) {
  if (!value || value.length <= maxChars) {
    return value || '';
  }
  return value.slice(0, maxChars) + '\n...[truncated ' + (value.length - maxChars) + ' chars]';
}

function applyDashboardUpdate(dashboard) {
  state.dashboard = dashboard;
  ensureSelectedRun();
}

function applyControlPlaneUpdate(controlPlane) {
  state.controlPlane = controlPlane;
  const nextDrafts = {};
  for (const prompt of state.controlPlane.prompts || []) {
    if (prompt.kind === 'text') {
      nextDrafts[prompt.id] = state.promptDrafts[prompt.id]
        || (typeof prompt.defaultValue === 'string' ? prompt.defaultValue : '');
    }
  }
  state.promptDrafts = nextDrafts;
}

function renderRunList(runs) {
  if (runs.length === 0) {
    return '<div class="panel"><p class="subtle">No Otto runs found yet.</p></div>';
  }
  return '<div class="runs-list">' + runs.map((run) => {
    const active = run.runId === state.selectedRunId ? ' active' : '';
    const waiting = run.needsUserInput ? '<span class="badge waiting">waiting</span>' : '';
    return '<button class="run-row' + active + '" data-run-id="' + escapeHtml(run.runId) + '">' +
      '<div class="run-row-title">' +
        '<strong>' + escapeHtml(run.ticketSlug || run.runId) + '</strong>' +
        statusBadge(run.processStatus) +
      '</div>' +
      '<p class="subtle mono">' + escapeHtml(run.runId) + '</p>' +
      '<div class="badge-row">' +
        '<span class="badge">' + escapeHtml(run.phase || 'unknown') + '</span>' +
        '<span class="badge">queue ' + escapeHtml(run.taskQueueLength) + '</span>' +
        waiting +
      '</div>' +
    '</button>';
  }).join('') + '</div>';
}

function renderTicketList(tickets) {
  if (!tickets.length) {
    return '<p class="subtle">No managed tickets yet.</p>';
  }
  return '<div class="ticket-list">' + tickets.map((ticket) => {
    const action = ticket.hasRun
      ? '<span class="badge">started</span>'
      : '<button class="button button-secondary ticket-start-button" data-ticket-id="' + escapeHtml(ticket.ticketId) + '"' + (isRunBusy(ticket.ticketId) ? ' disabled' : '') + '>Start</button>';
    return '<div class="ticket-row">' +
      '<div>' +
        '<strong class="mono">' + escapeHtml(ticket.ticketId) + '</strong>' +
      '</div>' +
      action +
    '</div>';
  }).join('') + '</div>';
}

function renderArtifacts(artifacts) {
  return artifacts.map((artifact) => {
    const body = artifact.exists
      ? '<pre>' + escapeHtml(artifact.content || '') + '</pre>'
      : '<p class="subtle">Not present yet.</p>';
    const trunc = artifact.truncated ? '<span class="badge">truncated</span>' : '';
    return '<article class="artifact-card">' +
      '<div class="detail-topline">' +
        '<div><p class="eyebrow">Artifact</p><h3>' + escapeHtml(artifact.title) + '</h3></div>' +
        '<div class="detail-badges">' +
          '<span class="badge mono">' + escapeHtml(artifact.language) + '</span>' + trunc +
        '</div>' +
      '</div>' +
      '<p class="footer-note mono">' + escapeHtml(artifact.path) + '</p>' +
      body +
    '</article>';
  }).join('');
}

function renderJsonLines(title, items, formatter) {
  const body = items.length > 0
    ? '<pre>' + escapeHtml(items.map(formatter).join('\\n\\n')) + '</pre>'
    : '<p class="subtle">No entries yet.</p>';
  return '<article class="timeline-card">' +
    '<p class="eyebrow">Timeline</p>' +
    '<h3>' + escapeHtml(title) + '</h3>' +
    body +
  '</article>';
}

function renderAgUiLines(runId) {
  const items = getAgUiEvents(runId);
  const body = items.length > 0
    ? '<div class="prompt-list">' + items.slice().reverse().map((event) => {
        let summary = '';
        if (event.type === 'RUN_STARTED') {
          summary = 'Run started for ' + escapeHtml(event.runId || runId) + '.';
        } else if (event.type === 'RUN_FINISHED') {
          summary = truncateText(JSON.stringify(event.result || {}, null, 2), 1200);
        } else if (event.type === 'RUN_ERROR') {
          summary = escapeHtml(event.message || 'Run error');
        } else if (event.type === 'TOOL_CALL_START') {
          summary = 'Tool call started: ' + escapeHtml(event.toolCallName || event.toolCallId || 'unknown');
        } else if (event.type === 'TOOL_CALL_ARGS') {
          summary = truncateText(String(event.delta || ''), 1200);
        } else if (event.type === 'TOOL_CALL_RESULT') {
          summary = truncateText(String(event.content || ''), 1200);
        } else if (event.type === 'RAW') {
          summary = truncateText(JSON.stringify(event.event || event.rawEvent || {}, null, 2), 1200);
        } else if (event.type === 'CUSTOM') {
          summary = truncateText(JSON.stringify(event.value || {}, null, 2), 1200);
        } else {
          summary = truncateText(JSON.stringify(event, null, 2), 1200);
        }

        return '<div class="prompt-card">' +
          '<div class="detail-topline">' +
            '<div><p class="eyebrow">' + escapeHtml(event.type || 'EVENT') + '</p><p class="subtle">' + escapeHtml(event.name || event.source || '') + '</p></div>' +
            '<span class="badge mono">' + escapeHtml(event.timestamp ? formatDate(event.timestamp) : '-') + '</span>' +
          '</div>' +
          '<pre class="prompt-message">' + escapeHtml(summary) + '</pre>' +
        '</div>';
      }).join('') + '</div>'
    : '<p class="subtle">No AG-UI events captured yet for this run.</p>';
  return '<article class="timeline-card">' +
    '<p class="eyebrow">AG-UI</p>' +
    '<h3>Run event feed</h3>' +
    body +
  '</article>';
}

function renderActionStatus() {
  if (state.actionError) {
    return '<div class="action-banner error">' + escapeHtml(state.actionError) + '</div>';
  }
  if (state.actionMessage) {
    return '<div class="action-banner success">' + escapeHtml(state.actionMessage) + '</div>';
  }
  return '';
}

function renderJobStatus() {
  const jobs = state.controlPlane?.jobs ?? [];
  if (!jobs.length) return '';

  const activeJobs = getActiveJobs();
  const visibleJobs = activeJobs.length > 0 ? activeJobs : jobs.slice(0, 3);
  return '<div class="panel stack">' +
    '<div><p class="eyebrow">Jobs</p><p class="subtle">Server-managed workflow activity across concurrent Otto runs.</p></div>' +
    '<div class="ticket-list">' + visibleJobs.map((job) => {
      const className = job.status === 'waiting' ? 'waiting' : job.status === 'failed' ? 'stale' : job.status === 'succeeded' ? 'done' : 'active';
      const detail = job.error ? '<p class="footer-note">' + escapeHtml(job.error) + '</p>' : '';
      return '<div class="ticket-row">' +
        '<div>' +
          '<strong>' + escapeHtml(job.kind) + '</strong> <span class="mono">' + escapeHtml(job.runId) + '</span>' +
          detail +
        '</div>' +
        '<div class="badge-row">' +
          '<span class="badge ' + className + '">' + escapeHtml(job.status) + '</span>' +
          '<span class="badge mono">' + escapeHtml(formatDate(job.startedAt)) + '</span>' +
        '</div>' +
      '</div>';
    }).join('') + '</div>' +
  '</div>';
}

function renderPromptInbox() {
  const prompts = getPromptList();
  if (!prompts.length) return '';

  return '<div class="panel stack prompt-panel">' +
    '<div><p class="eyebrow">Prompt inbox</p><p class="subtle">The server is waiting on input for ' + escapeHtml(prompts.length) + ' prompt' + (prompts.length === 1 ? '' : 's') + '.</p></div>' +
    '<div class="prompt-list">' + prompts.map((prompt) => {
      let body = '';
      if (prompt.kind === 'confirm') {
        body = '<div class="prompt-actions">' +
          '<button class="button button-primary prompt-confirm-button" data-prompt-id="' + escapeHtml(prompt.id) + '" data-value="true">Confirm</button>' +
          '<button class="button prompt-confirm-button" data-prompt-id="' + escapeHtml(prompt.id) + '" data-value="false">Cancel</button>' +
        '</div>';
      } else if (prompt.kind === 'select') {
        body = '<div class="prompt-actions">' + (prompt.choices || []).map((choice) =>
          '<button class="button prompt-select-button" data-prompt-id="' + escapeHtml(prompt.id) + '" data-choice="' + escapeHtml(choice) + '">' + escapeHtml(choice) + '</button>'
        ).join('') + '</div>';
      } else {
        body = '<textarea class="text-input prompt-draft-input" rows="6" data-prompt-id="' + escapeHtml(prompt.id) + '">' + escapeHtml(getPromptDraft(prompt)) + '</textarea>' +
          '<div class="prompt-actions">' +
          '<button class="button button-primary submit-prompt-button" data-prompt-id="' + escapeHtml(prompt.id) + '">Submit response</button>' +
          '</div>';
      }

      return '<div class="prompt-card">' +
        '<div class="detail-topline">' +
          '<div><p class="eyebrow">' + escapeHtml(prompt.kind) + '</p><p class="subtle">Run <span class="mono">' + escapeHtml(prompt.runId) + '</span></p></div>' +
          '<span class="badge mono">' + escapeHtml(formatDate(prompt.createdAt)) + '</span>' +
        '</div>' +
        '<pre class="prompt-message">' + escapeHtml(prompt.message) + '</pre>' +
        body +
      '</div>';
    }).join('') + '</div>' +
  '</div>';
}

function renderDetail(detail) {
  if (!detail) {
    return '<div class="stack">' + renderPromptInbox() + '<div class="empty-state"><div><span class="wordmark">OTTO</span><p>Select a run to inspect its artifacts and telemetry.</p></div></div></div>';
  }

  const run = detail.summary;
  const eventsCard = renderJsonLines('Run events', detail.recentEvents, (entry) => {
    return '[' + entry.at + '] ' + entry.type + (entry.data ? '\\n' + JSON.stringify(entry.data, null, 2) : '');
  });
  const execCard = renderJsonLines('Exec events', detail.recentExecs, (entry) => {
    return '[' + entry.at + '] ' + entry.label + ' exit=' + entry.exitCode + ' timedOut=' + entry.timedOut + ' durationMs=' + entry.durationMs;
  });
  const agUiCard = renderAgUiLines(run.runId);
  const deleteLabel = state.isDeletingRun ? 'Deleting...' : 'Delete run';
  const canResume = run.processStatus !== 'active';
  const canMergeBack = run.processStatus !== 'active' && run.finalReportAvailable;
  const runBusy = isRunBusy(run.runId);

  return '<div class="stack">' +
    renderPromptInbox() +
    renderActionStatus() +
    '<section class="header-block">' +
      '<div class="toolbar">' +
        '<div>' +
          '<p class="eyebrow">Run detail</p>' +
          '<h1 class="title">' + escapeHtml(run.ticketSlug || run.runId) + '</h1>' +
          '<p class="subtle mono">' + escapeHtml(run.runId) + '</p>' +
        '</div>' +
        '<div class="detail-actions">' +
          '<div class="detail-badges">' +
            statusBadge(run.processStatus) +
            '<span class="badge">phase ' + escapeHtml(run.phase || 'unknown') + '</span>' +
            (run.needsUserInput ? '<span class="badge waiting">awaiting input</span>' : '') +
          '</div>' +
          '<div class="prompt-actions">' +
            (canResume ? '<button class="button button-primary" id="resume-run-button" data-run-id="' + escapeHtml(run.runId) + '"' + (runBusy ? ' disabled' : '') + '>Resume</button>' : '') +
            (canMergeBack ? '<button class="button button-secondary" id="merge-back-button" data-run-id="' + escapeHtml(run.runId) + '"' + (runBusy ? ' disabled' : '') + '>Merge back</button>' : '') +
            '<button class="button button-danger" id="delete-run-button" data-run-id="' + escapeHtml(run.runId) + '"' + (state.isDeletingRun || runBusy ? ' disabled' : '') + '>' + deleteLabel + '</button>' +
          '</div>' +
        '</div>' +
      '</div>' +
      '<div class="grid-two" style="margin-top: 20px;">' +
        '<div class="panel">' +
          '<dl class="keyvals">' +
            '<dt>Created</dt><dd>' + escapeHtml(formatDate(run.createdAt)) + '</dd>' +
            '<dt>Branch</dt><dd class="mono">' + escapeHtml(run.branchName) + '</dd>' +
            '<dt>Base</dt><dd class="mono">' + escapeHtml(run.baseBranch) + '</dd>' +
            '<dt>Worktree</dt><dd class="mono">' + escapeHtml(detail.worktreePath) + '</dd>' +
            '<dt>State file</dt><dd class="mono">' + escapeHtml(detail.stateFilePath) + '</dd>' +
            '<dt>Ticket file</dt><dd class="mono">' + escapeHtml(detail.ticketFilePath) + '</dd>' +
          '</dl>' +
        '</div>' +
        '<div class="panel">' +
          '<dl class="keyvals">' +
            '<dt>Queue length</dt><dd>' + escapeHtml(run.taskQueueLength) + '</dd>' +
            '<dt>Artifacts</dt><dd>' + escapeHtml(detail.runFiles.length) + ' files</dd>' +
            '<dt>Plan</dt><dd>' + escapeHtml(run.planAvailable ? 'present' : 'missing') + '</dd>' +
            '<dt>Final report</dt><dd>' + escapeHtml(run.finalReportAvailable ? 'present' : 'missing') + '</dd>' +
            '<dt>Recent events</dt><dd>' + escapeHtml(detail.recentEvents.length) + '</dd>' +
            '<dt>Recent execs</dt><dd>' + escapeHtml(detail.recentExecs.length) + '</dd>' +
          '</dl>' +
        '</div>' +
      '</div>' +
    '</section>' +
    '<section class="grid-two">' +
      '<div class="artifact-grid">' + renderArtifacts(detail.artifacts) + '</div>' +
      '<div class="timeline-grid">' + agUiCard + eventsCard + execCard + '</div>' +
    '</section>' +
  '</div>';
}

function renderApp() {
  if (!state.dashboard || !state.controlPlane) {
    document.getElementById('app').innerHTML = '<div class="shell-loading"><span class="shell-mark">OTTO</span><p>Loading local control plane...</p></div>';
    return;
  }

  const dashboard = state.dashboard;
  const selectedDetail = state.selectedRunId ? state.detailCache.get(state.selectedRunId) : null;
  const createLabel = state.isCreatingTicket ? 'Creating...' : 'Create ticket';
  const ingestLabel = state.isIngestingTicket ? 'Ingesting...' : 'Ingest external ticket';

  document.getElementById('app').innerHTML = '<div class="app-shell">' +
    '<aside class="sidebar">' +
      '<div class="stack">' +
        '<div>' +
          '<span class="wordmark">OTTO WEB</span>' +
          '<h1 class="title">Local control plane</h1>' +
          '<p class="subtle">The server owns Otto jobs and prompt resolution. The browser is the operator surface.</p>' +
        '</div>' +
        '<div class="summary-grid">' +
          '<article><p class="eyebrow">Runs</p><div class="metric mono">' + dashboard.runCounts.total + '</div></article>' +
          '<article><p class="eyebrow">Active</p><div class="metric mono">' + dashboard.runCounts.active + '</div></article>' +
          '<article><p class="eyebrow">Tickets</p><div class="metric mono">' + dashboard.ticketsCount + '</div></article>' +
          '<article><p class="eyebrow">Runner</p><div class="metric mono" style="font-size:18px;">' + escapeHtml(dashboard.defaultRunnerId || 'n/a') + '</div></article>' +
        '</div>' +
        '<div class="panel stack">' +
          '<div class="toolbar">' +
            '<div><p class="eyebrow">Repository</p><p class="mono">' + escapeHtml(dashboard.repoPath) + '</p></div>' +
            '<div class="prompt-actions"><span class="badge ' + (state.liveStreamStatus === 'connected' ? 'done' : state.liveStreamStatus === 'error' ? 'stale' : 'waiting') + '">stream ' + escapeHtml(state.liveStreamStatus) + '</span><button class="button" id="refresh-button">Refresh</button></div>' +
          '</div>' +
          '<p class="subtle">Config: <span class="mono">' + escapeHtml(dashboard.configPath) + '</span></p>' +
          '<div class="detail-badges">' +
            '<span class="badge">onboarding ' + escapeHtml(dashboard.onboardingStatus || 'missing') + '</span>' +
            '<span class="badge">subagents ' + escapeHtml(dashboard.subagentsEnabled ? 'enabled' : 'disabled') + '</span>' +
          '</div>' +
        '</div>' +
        renderJobStatus() +
        '<div class="panel stack">' +
          '<div><p class="eyebrow">Create ticket</p><p class="subtle">Quick browser action routed through the shared core service layer.</p></div>' +
          '<textarea id="ticket-draft" class="text-input" rows="5" placeholder="Describe the work you want Otto to tackle.">' + escapeHtml(state.ticketDraft) + '</textarea>' +
          '<button class="button button-primary" id="create-ticket-button"' + (state.isCreatingTicket ? ' disabled' : '') + '>' + createLabel + '</button>' +
        '</div>' +
        '<div class="panel stack">' +
          '<div><p class="eyebrow">Ingest external ticket</p><p class="subtle">Paste or type markdown, or upload a file and send its contents through the ingest flow.</p></div>' +
          '<input id="ingest-file-input" class="file-input" type="file"' + (state.isIngestingTicket ? ' disabled' : '') + ' />' +
          '<input id="ingest-source-name" class="text-line-input mono" type="text" value="' + escapeHtml(state.ingestSourceName) + '"' + (state.isIngestingTicket ? ' disabled' : '') + ' />' +
          '<textarea id="ingest-draft" class="text-input" rows="7" placeholder="# Imported ticket\n\nPaste or type external ticket content here.">' + escapeHtml(state.ingestDraft) + '</textarea>' +
          '<button class="button button-primary" id="ingest-ticket-button"' + (state.isIngestingTicket ? ' disabled' : '') + '>' + ingestLabel + '</button>' +
        '</div>' +
        '<div class="panel stack">' +
          '<div><p class="eyebrow">Tickets</p><p class="subtle">Start browser-driven runs directly from the inventory.</p></div>' +
          renderTicketList(dashboard.tickets) +
        '</div>' +
      '</div>' +
      renderRunList(dashboard.runs) +
    '</aside>' +
    '<main class="main">' + renderDetail(selectedDetail) + '</main>' +
  '</div>';

  document.querySelectorAll('[data-run-id]').forEach((element) => {
    element.addEventListener('click', () => {
      const runId = element.getAttribute('data-run-id');
      if (!runId || state.isDeletingRun) return;
      state.selectedRunId = runId;
      void loadSelectedRun();
    });
  });

  document.querySelectorAll('.ticket-start-button').forEach((element) => {
    element.addEventListener('click', () => {
      const ticketId = element.getAttribute('data-ticket-id');
      if (!ticketId) return;
      void startRun(ticketId);
    });
  });

  document.querySelectorAll('.prompt-confirm-button').forEach((element) => {
    element.addEventListener('click', () => {
      const promptId = element.getAttribute('data-prompt-id');
      const value = element.getAttribute('data-value');
      if (!promptId) return;
      void submitPrompt(promptId, value === 'true');
    });
  });

  document.querySelectorAll('.prompt-select-button').forEach((element) => {
    element.addEventListener('click', () => {
      const promptId = element.getAttribute('data-prompt-id');
      const choice = element.getAttribute('data-choice');
      if (!promptId || choice == null) return;
      void submitPrompt(promptId, choice);
    });
  });

  connectLiveStream();
`;
