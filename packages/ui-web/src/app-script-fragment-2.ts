export const UI_WEB_APP_SCRIPT_FRAGMENT_2 = `  const refresh = document.getElementById('refresh-button');
  if (refresh) {
    refresh.addEventListener('click', () => {
      void refreshAll();
    });
  }

  const ticketDraft = document.getElementById('ticket-draft');
  if (ticketDraft) {
    ticketDraft.addEventListener('input', (event) => {
      state.ticketDraft = event.target.value;
    });
  }

  const ingestDraft = document.getElementById('ingest-draft');
  if (ingestDraft) {
    ingestDraft.addEventListener('input', (event) => {
      state.ingestDraft = event.target.value;
    });
  }

  const ingestSourceName = document.getElementById('ingest-source-name');
  if (ingestSourceName) {
    ingestSourceName.addEventListener('input', (event) => {
      state.ingestSourceName = event.target.value;
    });
  }

  const ingestFileInput = document.getElementById('ingest-file-input');
  if (ingestFileInput) {
    ingestFileInput.addEventListener('change', async (event) => {
      const file = event.target.files && event.target.files[0];
      if (!file) return;
      state.ingestSourceName = file.name || 'browser-ingest.md';
      state.ingestDraft = await file.text();
      renderApp();
    });
  }

  document.querySelectorAll('.prompt-draft-input').forEach((element) => {
    element.addEventListener('input', (event) => {
      const promptId = event.target.getAttribute('data-prompt-id');
      if (!promptId) return;
      state.promptDrafts[promptId] = event.target.value;
    });
  });

  document.querySelectorAll('.submit-prompt-button').forEach((element) => {
    element.addEventListener('click', () => {
      const promptId = element.getAttribute('data-prompt-id');
      if (!promptId) return;
      void submitPrompt(promptId, state.promptDrafts[promptId] || '');
    });
  });

  const createButton = document.getElementById('create-ticket-button');
  if (createButton) {
    createButton.addEventListener('click', () => {
      void createTicket();
    });
  }

  const ingestButton = document.getElementById('ingest-ticket-button');
  if (ingestButton) {
    ingestButton.addEventListener('click', () => {
      void ingestTicket();
    });
  }

  const deleteButton = document.getElementById('delete-run-button');
  if (deleteButton) {
    deleteButton.addEventListener('click', () => {
      const runId = deleteButton.getAttribute('data-run-id');
      if (!runId) return;
      void deleteRun(runId);
    });
  }

  const resumeButton = document.getElementById('resume-run-button');
  if (resumeButton) {
    resumeButton.addEventListener('click', () => {
      const runId = resumeButton.getAttribute('data-run-id');
      if (!runId) return;
      void resumeRun(runId);
    });
  }

  const mergeBackButton = document.getElementById('merge-back-button');
  if (mergeBackButton) {
    mergeBackButton.addEventListener('click', () => {
      const runId = mergeBackButton.getAttribute('data-run-id');
      if (!runId) return;
      void mergeBackRun(runId);
    });
  }
}

function connectAgUiStream() {
  const nextRunId = state.selectedRunId || null;
  if (!nextRunId) {
    if (agUiEventSource) {
      agUiEventSource.close();
      agUiEventSource = null;
      agUiRunId = null;
    }
    return;
  }

  if (agUiEventSource && agUiRunId === nextRunId) {
    return;
  }

  if (agUiEventSource) {
    agUiEventSource.close();
  }

  agUiEventSource = new EventSource('/api/runs/' + encodeURIComponent(nextRunId) + '/ag-ui');
  agUiRunId = nextRunId;
  state.agUiEventsByRun[nextRunId] = state.agUiEventsByRun[nextRunId] || [];

  agUiEventSource.onmessage = (event) => {
    const parsed = JSON.parse(event.data);
    const current = state.agUiEventsByRun[nextRunId] || [];
    state.agUiEventsByRun[nextRunId] = [...current, parsed].slice(-80);
    renderApp();
  };

  agUiEventSource.onerror = () => {
    // EventSource will retry automatically; keep the current feed visible.
  };
}

function connectLiveStream() {
  const nextRunId = state.selectedRunId || '';
  if (liveEventSource && liveStreamRunId === nextRunId) {
    return;
  }

  if (liveEventSource) {
    liveEventSource.close();
  }

  const query = nextRunId ? '?runId=' + encodeURIComponent(nextRunId) : '';
  liveEventSource = new EventSource('/api/stream' + query);
  liveStreamRunId = nextRunId;
  state.liveStreamStatus = 'connecting';

  liveEventSource.addEventListener('open', () => {
    state.liveStreamStatus = 'connected';
    renderApp();
  });

  liveEventSource.addEventListener('dashboard', (event) => {
    applyDashboardUpdate(JSON.parse(event.data));
    renderApp();
  });

  liveEventSource.addEventListener('control-plane', (event) => {
    applyControlPlaneUpdate(JSON.parse(event.data));
    renderApp();
  });

  liveEventSource.addEventListener('run-detail', (event) => {
    const payload = JSON.parse(event.data);
    if (payload.detail) {
      state.detailCache.set(payload.runId, payload.detail);
    } else {
      state.detailCache.delete(payload.runId);
    }
    if (!state.selectedRunId && payload.runId) {
      state.selectedRunId = payload.runId;
    }
    renderApp();
  });

  liveEventSource.addEventListener('error', () => {
    state.liveStreamStatus = 'error';
    renderApp();
  });
}

async function loadDashboard() {
  applyDashboardUpdate(await fetchJson('/api/status'));
}

async function loadControlPlane() {
  applyControlPlaneUpdate(await fetchJson('/api/control-plane'));
}

async function loadSelectedRun() {
  if (!state.selectedRunId) {
    connectAgUiStream();
    renderApp();
    return;
  }
  const detail = await fetchJson('/api/runs/' + encodeURIComponent(state.selectedRunId));
  state.detailCache.set(state.selectedRunId, detail);
  connectAgUiStream();
  renderApp();
}

async function refreshAll() {
  try {
    await Promise.all([loadDashboard(), loadControlPlane()]);
    connectLiveStream();
    renderApp();
    await loadSelectedRun();
  } catch (error) {
    document.getElementById('app').innerHTML = '<div class="error-state"><div><span class="wordmark">OTTO</span><p>' + escapeHtml(error.message || String(error)) + '</p></div></div>';
  }
}

async function createTicket() {
  const ticketText = state.ticketDraft.trim();
  if (!ticketText || state.isCreatingTicket) {
    return;
  }

  state.isCreatingTicket = true;
  clearActionState();
  renderApp();

  try {
    const result = await fetchJson('/api/tickets/create', {
      method: 'POST',
      headers: {
        accept: 'application/json',
        'content-type': 'application/json',
      },
      body: JSON.stringify({ ticketText }),
    });
    state.ticketDraft = '';
    state.actionMessage = 'Created ticket ' + result.ticketId + '.';
    await refreshAll();
  } catch (error) {
    state.actionError = error.message || String(error);
    renderApp();
  } finally {
    state.isCreatingTicket = false;
    renderApp();
  }
}

async function ingestTicket() {
  const sourceText = state.ingestDraft.trim();
  if (!sourceText || state.isIngestingTicket) {
    return;
  }

  state.isIngestingTicket = true;
  clearActionState();
  renderApp();

  try {
    const result = await fetchJson('/api/tickets/ingest', {
      method: 'POST',
      headers: {
        accept: 'application/json',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        sourceText: state.ingestDraft,
        sourceName: state.ingestSourceName,
      }),
    });
    state.ingestDraft = '';
    state.ingestSourceName = 'browser-ingest.md';
    state.actionMessage = 'Ingested ticket ' + result.ticketId + '.';
    await refreshAll();
  } catch (error) {
    state.actionError = error.message || String(error);
    renderApp();
  } finally {
    state.isIngestingTicket = false;
    renderApp();
  }
}

async function startRun(ticketId) {
  if (isRunBusy(ticketId)) return;
  clearActionState();
  renderApp();

  try {
    await fetchJson('/api/runs/start', {
      method: 'POST',
      headers: {
        accept: 'application/json',
        'content-type': 'application/json',
      },
      body: JSON.stringify({ ticketId }),
    });
    state.actionMessage = 'Started run job for ' + ticketId + '.';
    state.selectedRunId = ticketId;
    connectLiveStream();
    connectAgUiStream();
    await refreshAll();
  } catch (error) {
    state.actionError = error.message || String(error);
    renderApp();
  }
}

async function resumeRun(runId) {
  if (isRunBusy(runId)) return;
  clearActionState();
  renderApp();

  try {
    await fetchJson('/api/runs/' + encodeURIComponent(runId) + '/resume', {
      method: 'POST',
      headers: { accept: 'application/json' },
    });
    state.actionMessage = 'Started resume job for ' + runId + '.';
    state.selectedRunId = runId;
    connectLiveStream();
    connectAgUiStream();
    await refreshAll();
  } catch (error) {
    state.actionError = error.message || String(error);
    renderApp();
  }
}

async function mergeBackRun(runId) {
  if (isRunBusy(runId)) return;
  clearActionState();
  renderApp();

  try {
    await fetchJson('/api/runs/' + encodeURIComponent(runId) + '/merge-back', {
      method: 'POST',
      headers: { accept: 'application/json' },
    });
    state.actionMessage = 'Started merge-back job for ' + runId + '.';
    state.selectedRunId = runId;
    connectLiveStream();
    connectAgUiStream();
    await refreshAll();
  } catch (error) {
    state.actionError = error.message || String(error);
    renderApp();
  }
}

async function deleteRun(runId) {
  if (state.isDeletingRun || isRunBusy(runId)) {
    return;
  }

  state.isDeletingRun = true;
  clearActionState();
  renderApp();

  try {
    const result = await fetchJson('/api/runs/' + encodeURIComponent(runId) + '/delete', {
      method: 'POST',
      headers: { accept: 'application/json' },
    });
    state.detailCache.delete(runId);
    if (state.selectedRunId === runId) {
      state.selectedRunId = null;
    }
    state.actionMessage = 'Deleted run ' + result.runId + '.';
    await refreshAll();
  } catch (error) {
    state.actionError = error.message || String(error);
    renderApp();
  } finally {
    state.isDeletingRun = false;
    renderApp();
  }
}

async function submitPrompt(promptId, value) {
  clearActionState();
  renderApp();

  try {
    await fetchJson('/api/prompts/' + encodeURIComponent(promptId) + '/respond', {
      method: 'POST',
      headers: {
        accept: 'application/json',
        'content-type': 'application/json',
      },
      body: JSON.stringify({ value }),
    });
    delete state.promptDrafts[promptId];
    state.actionMessage = 'Submitted prompt response.';
    await refreshAll();
  } catch (error) {
    state.actionError = error.message || String(error);
    renderApp();
  }
}

void refreshAll();
window.setInterval(() => {
  void refreshAll();
}, 20000);
`;
