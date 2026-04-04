export const UI_WEB_APP_SCRIPT = `const state = {
  dashboard: null,
  selectedRunId: null,
  detailCache: new Map(),
};

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

async function fetchJson(url) {
  const response = await fetch(url, { headers: { accept: "application/json" } });
  if (!response.ok) {
    throw new Error(await response.text() || ("Request failed: " + response.status));
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
    ? '<pre>' + escapeHtml(items.map(formatter).join('\n\n')) + '</pre>'
    : '<p class="subtle">No entries yet.</p>';
  return '<article class="timeline-card">' +
    '<p class="eyebrow">Timeline</p>' +
    '<h3>' + escapeHtml(title) + '</h3>' +
    body +
  '</article>';
}

function renderDetail(detail) {
  if (!detail) {
    return '<div class="empty-state"><div><span class="wordmark">OTTO</span><p>Select a run to inspect its artifacts and telemetry.</p></div></div>';
  }

  const run = detail.summary;
  const eventsCard = renderJsonLines('Run events', detail.recentEvents, (entry) => {
    return '[' + entry.at + '] ' + entry.type + (entry.data ? '\n' + JSON.stringify(entry.data, null, 2) : '');
  });
  const execCard = renderJsonLines('Exec events', detail.recentExecs, (entry) => {
    return '[' + entry.at + '] ' + entry.label + ' exit=' + entry.exitCode + ' timedOut=' + entry.timedOut + ' durationMs=' + entry.durationMs;
  });

  return '<div class="stack">' +
    '<section class="header-block">' +
      '<div class="toolbar">' +
        '<div>' +
          '<p class="eyebrow">Run detail</p>' +
          '<h1 class="title">' + escapeHtml(run.ticketSlug || run.runId) + '</h1>' +
          '<p class="subtle mono">' + escapeHtml(run.runId) + '</p>' +
        '</div>' +
        '<div class="detail-badges">' +
          statusBadge(run.processStatus) +
          '<span class="badge">phase ' + escapeHtml(run.phase || 'unknown') + '</span>' +
          (run.needsUserInput ? '<span class="badge waiting">awaiting input</span>' : '') +
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
      '<div class="timeline-grid">' + eventsCard + execCard + '</div>' +
    '</section>' +
  '</div>';
}

function renderApp() {
  if (!state.dashboard) {
    document.getElementById('app').innerHTML = '<div class="shell-loading"><span class="shell-mark">OTTO</span><p>Loading local control plane...</p></div>';
    return;
  }

  const dashboard = state.dashboard;
  const selectedDetail = state.selectedRunId ? state.detailCache.get(state.selectedRunId) : null;

  document.getElementById('app').innerHTML = '<div class="app-shell">' +
    '<aside class="sidebar">' +
      '<div class="stack">' +
        '<div>' +
          '<span class="wordmark">OTTO WEB</span>' +
          '<h1 class="title">Local control plane</h1>' +
          '<p class="subtle">Read-only Phase 1 surface for run visibility, artifacts, and live telemetry.</p>' +
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
            '<button class="button" id="refresh-button">Refresh</button>' +
          '</div>' +
          '<p class="subtle">Config: <span class="mono">' + escapeHtml(dashboard.configPath) + '</span></p>' +
          '<div class="detail-badges">' +
            '<span class="badge">onboarding ' + escapeHtml(dashboard.onboardingStatus || 'missing') + '</span>' +
            '<span class="badge">subagents ' + escapeHtml(dashboard.subagentsEnabled ? 'enabled' : 'disabled') + '</span>' +
          '</div>' +
        '</div>' +
      '</div>' +
      renderRunList(dashboard.runs) +
    '</aside>' +
    '<main class="main">' + renderDetail(selectedDetail) + '</main>' +
  '</div>';

  document.querySelectorAll('[data-run-id]').forEach((element) => {
    element.addEventListener('click', () => {
      const runId = element.getAttribute('data-run-id');
      if (!runId) return;
      state.selectedRunId = runId;
      void loadSelectedRun();
    });
  });

  const refresh = document.getElementById('refresh-button');
  if (refresh) {
    refresh.addEventListener('click', () => {
      void refreshAll();
    });
  }
}

async function loadDashboard() {
  state.dashboard = await fetchJson('/api/status');
  ensureSelectedRun();
}

async function loadSelectedRun() {
  if (!state.selectedRunId) {
    renderApp();
    return;
  }
  const detail = await fetchJson('/api/runs/' + encodeURIComponent(state.selectedRunId));
  state.detailCache.set(state.selectedRunId, detail);
  renderApp();
}

async function refreshAll() {
  try {
    await loadDashboard();
    renderApp();
    await loadSelectedRun();
  } catch (error) {
    document.getElementById('app').innerHTML = '<div class="error-state"><div><span class="wordmark">OTTO</span><p>' + escapeHtml(error.message || String(error)) + '</p></div></div>';
  }
}

void refreshAll();
window.setInterval(() => {
  void refreshAll();
}, 4000);
`;
