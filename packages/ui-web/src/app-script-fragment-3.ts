export const UI_WEB_APP_SCRIPT_FRAGMENT_3 = `function getAgUiEvents(runId) {
  return state.agUiEventsByRun[runId] || [];
}

function truncateText(value, maxChars) {
  if (!value || value.length <= maxChars) {
    return value || '';
  }
  return value.slice(0, maxChars) + '\n...[truncated ' + (value.length - maxChars) + ' chars]';
}

function classifyAgUiEvent(event) {
  if (event.type === 'RUN_ERROR') return 'error';
  if (event.type === 'TOOL_CALL_RESULT') return 'tool';
  if (event.type === 'TOOL_CALL_START' || event.type === 'TOOL_CALL_ARGS' || event.type === 'TOOL_CALL_END') return 'tool';
  if (event.type === 'TEXT_MESSAGE_START' || event.type === 'TEXT_MESSAGE_CONTENT' || event.type === 'TEXT_MESSAGE_END') return 'message';
  if (event.type === 'CUSTOM' && event.name === 'otto.reasoning') return 'reasoning';
  if (event.type === 'CUSTOM' && event.name === 'otto.control_plane') return 'control';
  if (event.type === 'RAW') return 'raw';
  return 'neutral';
}

function summarizeAgUiEvent(runId, event) {
  if (event.type === 'RUN_STARTED') return { title: 'Run started', meta: event.runId || runId, body: 'Run started for ' + (event.runId || runId) + '.' };
  if (event.type === 'RUN_FINISHED') return { title: 'Run finished', meta: '', body: truncateText(JSON.stringify(event.result || {}, null, 2), 1200) };
  if (event.type === 'RUN_ERROR') return { title: 'Run error', meta: '', body: String(event.message || 'Run error') };
  if (event.type === 'TEXT_MESSAGE_CONTENT') return { title: 'Assistant message', meta: event.messageId || '', body: truncateText(String(event.delta || ''), 1200) };
  if (event.type === 'TEXT_MESSAGE_START' || event.type === 'TEXT_MESSAGE_END') return { title: event.type === 'TEXT_MESSAGE_START' ? 'Message started' : 'Message ended', meta: event.messageId || '', body: '' };
  if (event.type === 'TOOL_CALL_START') return { title: 'Tool started', meta: event.toolCallName || event.toolCallId || '', body: 'Tool call started: ' + String(event.toolCallName || event.toolCallId || 'unknown') };
  if (event.type === 'TOOL_CALL_ARGS') return { title: 'Tool input', meta: event.toolCallId || '', body: truncateText(String(event.delta || ''), 1200) };
  if (event.type === 'TOOL_CALL_RESULT') return { title: 'Tool result', meta: event.toolCallId || '', body: truncateText(String(event.content || ''), 1200) };
  if (event.type === 'TOOL_CALL_END') return { title: 'Tool ended', meta: event.toolCallId || '', body: '' };
  if (event.type === 'CUSTOM' && event.name === 'otto.reasoning') return { title: 'Reasoning', meta: '', body: truncateText(JSON.stringify(event.value || {}, null, 2), 1200) };
  if (event.type === 'CUSTOM' && event.name === 'otto.control_plane') {
    const jobs = Array.isArray(event.value?.jobs) ? event.value.jobs.length : 0;
    const prompts = Array.isArray(event.value?.prompts) ? event.value.prompts.length : 0;
    return { title: 'Control plane', meta: 'jobs ' + jobs + ' / prompts ' + prompts, body: truncateText(JSON.stringify(event.value || {}, null, 2), 1200) };
  }
  if (event.type === 'RAW') return { title: 'Raw runner event', meta: event.source || '', body: truncateText(JSON.stringify(event.event || event.rawEvent || {}, null, 2), 1200) };
  return { title: event.type || 'Event', meta: event.name || event.source || '', body: truncateText(JSON.stringify(event, null, 2), 1200) };
}

function renderAgUiLines(runId) {
  const items = getAgUiEvents(runId);
  const body = items.length > 0
    ? '<div class="prompt-list">' + items.slice().reverse().map((event) => {
        const kind = classifyAgUiEvent(event);
        const summary = summarizeAgUiEvent(runId, event);
        const body = summary.body
          ? '<pre class="prompt-message">' + escapeHtml(summary.body) + '</pre>'
          : '<p class="footer-note">No body payload.</p>';

        return '<div class="prompt-card ag-ui-card ag-ui-card-' + escapeHtml(kind) + '">' +
          '<div class="detail-topline">' +
            '<div><p class="eyebrow">' + escapeHtml(event.type || 'EVENT') + '</p><p class="subtle">' + escapeHtml(summary.title) + '</p></div>' +
            '<div class="badge-row">' +
              (summary.meta ? '<span class="badge mono">' + escapeHtml(summary.meta) + '</span>' : '') +
              '<span class="badge mono">' + escapeHtml(event.timestamp ? formatDate(event.timestamp) : '-') + '</span>' +
            '</div>' +
          '</div>' +
          body +
        '</div>';
      }).join('') + '</div>'
    : '<p class="subtle">No AG-UI events captured yet for this run.</p>';
  return '<article class="timeline-card">' +
    '<p class="eyebrow">AG-UI</p>' +
    '<h3>Run event feed</h3>' +
    body +
  '</article>';
}
`;
