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

  const promptDraft = document.getElementById('prompt-draft');
  if (promptDraft) {
    promptDraft.addEventListener('input', (event) => {
      state.promptDraft = event.target.value;
    });
  }

  const submitPromptButton = document.getElementById('submit-prompt-button');
  if (submitPromptButton) {
    submitPromptButton.addEventListener('click', () => {
      const promptId = submitPromptButton.getAttribute('data-prompt-id');
      if (!promptId) return;
      void submitPrompt(promptId, state.promptDraft);
    });
  }

  const createButton = document.getElementById('create-ticket-button');
  if (createButton) {
    createButton.addEventListener('click', () => {
      void createTicket();
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

async function loadDashboard() {
  state.dashboard = await fetchJson('/api/status');
  ensureSelectedRun();
}

async function loadControlPlane() {
  state.controlPlane = await fetchJson('/api/control-plane');
  const prompt = state.controlPlane.pendingPrompt;
  if (prompt && prompt.id !== state.seenPromptId) {
    state.seenPromptId = prompt.id;
    if (prompt.kind === 'text') {
      state.promptDraft = typeof prompt.defaultValue === 'string' ? prompt.defaultValue : '';
    }
  }
  if (!prompt) {
    state.seenPromptId = null;
    state.promptDraft = '';
  }
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
    await Promise.all([loadDashboard(), loadControlPlane()]);
    renderApp();
    await loadSelectedRun();
  } catch (error) {
    document.getElementById('app').innerHTML = '<div class="error-state"><div><span class="wordmark">OTTO</span><p>' + escapeHtml(error.message || String(error)) + '</p></div></div>';
  }
}

async function createTicket() {
  const ticketText = state.ticketDraft.trim();
  if (!ticketText || state.isCreatingTicket || isJobBusy()) {
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

async function startRun(ticketId) {
  if (isJobBusy()) return;
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
    await refreshAll();
  } catch (error) {
    state.actionError = error.message || String(error);
    renderApp();
  }
}

async function resumeRun(runId) {
  if (isJobBusy()) return;
  clearActionState();
  renderApp();

  try {
    await fetchJson('/api/runs/' + encodeURIComponent(runId) + '/resume', {
      method: 'POST',
      headers: { accept: 'application/json' },
    });
    state.actionMessage = 'Started resume job for ' + runId + '.';
    state.selectedRunId = runId;
    await refreshAll();
  } catch (error) {
    state.actionError = error.message || String(error);
    renderApp();
  }
}

async function mergeBackRun(runId) {
  if (isJobBusy()) return;
  clearActionState();
  renderApp();

  try {
    await fetchJson('/api/runs/' + encodeURIComponent(runId) + '/merge-back', {
      method: 'POST',
      headers: { accept: 'application/json' },
    });
    state.actionMessage = 'Started merge-back job for ' + runId + '.';
    state.selectedRunId = runId;
    await refreshAll();
  } catch (error) {
    state.actionError = error.message || String(error);
    renderApp();
  }
}

async function deleteRun(runId) {
  if (state.isDeletingRun || isJobBusy()) {
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
}, 2500);
`;
