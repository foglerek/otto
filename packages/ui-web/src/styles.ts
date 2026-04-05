export const UI_WEB_STYLES = `:root {
  color-scheme: dark;
  --bg: #0c1117;
  --panel: #111823;
  --panel-2: #0f1620;
  --panel-3: #131d2a;
  --border: rgba(202, 214, 229, 0.12);
  --border-strong: rgba(202, 214, 229, 0.2);
  --text: #ecf2fb;
  --text-secondary: #b7c4d6;
  --text-muted: #8191a7;
  --text-faint: #5b687a;
  --accent: #58a6ff;
  --accent-soft: rgba(88, 166, 255, 0.14);
  --success: #59c58a;
  --warning: #d9a441;
  --danger: #f26d78;
  --radius-sm: 6px;
  --radius: 10px;
  --radius-lg: 14px;
  --shadow: 0 0 0 1px rgba(255, 255, 255, 0.02), 0 12px 32px rgba(0, 0, 0, 0.24);
  --mono: "SFMono-Regular", "SF Mono", ui-monospace, Menlo, Monaco, Consolas, monospace;
  --sans: Inter, "SF Pro Display", "Segoe UI", sans-serif;
}

* {
  box-sizing: border-box;
}

html,
body {
  margin: 0;
  min-height: 100%;
  background:
    radial-gradient(circle at top right, rgba(88, 166, 255, 0.08), transparent 28%),
    linear-gradient(180deg, #0e141c 0%, var(--bg) 100%);
  color: var(--text);
  font-family: var(--sans);
}

body {
  min-height: 100vh;
}

button,
input,
textarea {
  font: inherit;
}

#app {
  min-height: 100vh;
}

.shell-loading,
.empty-state,
.error-state {
  min-height: 100vh;
  display: grid;
  place-items: center;
  gap: 12px;
  color: var(--text-secondary);
  text-align: center;
  padding: 24px;
}

.shell-mark,
.wordmark {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: 6px 10px;
  border: 1px solid var(--border-strong);
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.03);
  color: var(--text);
  font-family: var(--mono);
  font-size: 12px;
  letter-spacing: 0.12em;
}

.app-shell {
  min-height: 100vh;
  display: grid;
  grid-template-columns: 372px minmax(0, 1fr);
}

.sidebar {
  border-right: 1px solid var(--border);
  background: rgba(9, 14, 20, 0.82);
  backdrop-filter: blur(14px);
  padding: 24px;
  display: grid;
  align-content: start;
  gap: 16px;
  max-height: 100vh;
  overflow: auto;
}

.main {
  padding: 28px;
  display: grid;
  align-content: start;
  gap: 24px;
}

.header-block,
.panel,
.summary-grid article,
.run-row,
.artifact-card,
.timeline-card {
  border: 1px solid var(--border);
  background: linear-gradient(180deg, rgba(19, 29, 42, 0.94), rgba(15, 22, 32, 0.98));
  box-shadow: var(--shadow);
}

.header-block,
.panel,
.summary-grid article,
.artifact-card,
.timeline-card {
  border-radius: var(--radius-lg);
}

.header-block,
.panel,
.artifact-card,
.timeline-card {
  padding: 20px;
}

.summary-grid {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 12px;
}

.summary-grid-compact {
  grid-template-columns: repeat(2, minmax(0, 1fr));
}

.summary-grid article {
  padding: 16px;
}

.eyebrow {
  color: var(--text-muted);
  font-size: 12px;
  letter-spacing: 0.08em;
  text-transform: uppercase;
}

.title {
  margin: 8px 0 0;
  font-size: 26px;
  line-height: 1.05;
  letter-spacing: -0.03em;
}

.hero-title,
.detail-title {
  font-size: 40px;
  line-height: 0.94;
  letter-spacing: -0.045em;
}

.hero-copy {
  max-width: 32ch;
  font-size: 15px;
  line-height: 1.45;
}

.subtle {
  color: var(--text-secondary);
}

.mono {
  font-family: var(--mono);
  font-variant-numeric: tabular-nums;
}

.metric {
  margin-top: 10px;
  font-size: 28px;
  line-height: 1;
  letter-spacing: -0.03em;
}

.stack {
  display: grid;
  gap: 12px;
}

.sidebar-stack {
  gap: 16px;
}

.runs-list {
  display: grid;
  gap: 10px;
}

.run-row {
  width: 100%;
  border-radius: var(--radius);
  padding: 16px;
  cursor: pointer;
  text-align: left;
  color: inherit;
}

.run-row:hover {
  border-color: var(--border-strong);
}

.run-row.active {
  background: linear-gradient(180deg, rgba(88, 166, 255, 0.16), rgba(19, 29, 42, 0.98));
  border-color: rgba(88, 166, 255, 0.28);
}

.run-row-title,
.detail-topline {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

.run-row p,
.header-block p,
.artifact-card p,
.timeline-card p,
.panel p,
.panel li,
.sidebar p {
  margin: 0;
}

.badge-row,
.detail-badges {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.badge {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: 5px 10px;
  border-radius: 999px;
  border: 1px solid var(--border);
  background: rgba(255, 255, 255, 0.03);
  color: var(--text-secondary);
  font-size: 12px;
  white-space: nowrap;
}

.badge.active {
  color: var(--accent);
  border-color: rgba(88, 166, 255, 0.22);
  background: var(--accent-soft);
}

.badge.stale {
  color: var(--warning);
}

.badge.waiting {
  color: var(--warning);
}

.badge.done {
  color: var(--success);
}

.grid-two {
  display: grid;
  grid-template-columns: minmax(0, 1.45fr) minmax(340px, 0.95fr);
  gap: 24px;
}

.artifact-grid,
.timeline-grid {
  display: grid;
  gap: 12px;
}

.artifact-card pre,
.timeline-card pre {
  margin: 0;
  padding: 16px;
  border-radius: var(--radius);
  border: 1px solid rgba(202, 214, 229, 0.08);
  background: rgba(7, 11, 17, 0.62);
  color: #dce7f6;
  overflow: auto;
  white-space: pre-wrap;
  word-break: break-word;
  font-family: var(--mono);
  font-size: 12px;
  line-height: 1.55;
}

.keyvals {
  display: grid;
  grid-template-columns: 124px 1fr;
  gap: 8px 12px;
  font-size: 13px;
}

.keyvals dt {
  color: var(--text-muted);
}

.keyvals dd {
  margin: 0;
  color: var(--text);
  overflow-wrap: anywhere;
}

.toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

.detail-actions {
  display: grid;
  justify-items: end;
  gap: 10px;
}

.detail-header {
  align-items: start;
}

.button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  padding: 10px 14px;
  border-radius: var(--radius-sm);
  border: 1px solid var(--border-strong);
  background: rgba(255, 255, 255, 0.03);
  color: var(--text);
  cursor: pointer;
  white-space: nowrap;
}

.button:disabled {
  opacity: 0.6;
  cursor: default;
}

.button:hover {
  border-color: rgba(88, 166, 255, 0.28);
  background: rgba(88, 166, 255, 0.08);
}

.button-primary {
  border-color: rgba(88, 166, 255, 0.3);
  background: linear-gradient(180deg, rgba(88, 166, 255, 0.22), rgba(88, 166, 255, 0.14));
}

.button-danger {
  border-color: rgba(242, 109, 120, 0.24);
  color: #ffd6da;
}

.button-danger:hover {
  border-color: rgba(242, 109, 120, 0.32);
  background: rgba(242, 109, 120, 0.1);
}

.text-input {
  width: 100%;
  min-height: 132px;
  resize: vertical;
  padding: 12px;
  border-radius: var(--radius);
  border: 1px solid var(--border);
  background: rgba(7, 11, 17, 0.6);
  color: var(--text);
  outline: none;
}

.text-input:focus {
  border-color: rgba(88, 166, 255, 0.32);
}

.text-line-input,
.file-input {
  width: 100%;
  padding: 12px;
  border-radius: var(--radius);
  border: 1px solid var(--border);
  background: rgba(7, 11, 17, 0.6);
  color: var(--text);
  outline: none;
}

.text-line-input:focus,
.file-input:focus {
  border-color: rgba(88, 166, 255, 0.32);
}

.ticket-list {
  display: grid;
  gap: 8px;
}

.prompt-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.prompt-list {
  display: grid;
  gap: 12px;
}

.prompt-card {
  display: grid;
  gap: 12px;
  padding: 14px;
  border-radius: var(--radius);
  border: 1px solid rgba(202, 214, 229, 0.08);
  background: rgba(255, 255, 255, 0.02);
}

.ag-ui-card-message {
  border-color: rgba(88, 166, 255, 0.18);
}

.ag-ui-card-tool {
  border-color: rgba(89, 197, 138, 0.2);
}

.ag-ui-card-reasoning {
  border-color: rgba(217, 164, 65, 0.22);
}

.ag-ui-card-control {
  border-color: rgba(202, 214, 229, 0.16);
}

.ag-ui-card-error {
  border-color: rgba(242, 109, 120, 0.24);
}

.ag-ui-card-raw {
  border-color: rgba(202, 214, 229, 0.12);
}

.ticket-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 12px;
  border-radius: var(--radius-sm);
  border: 1px solid rgba(202, 214, 229, 0.08);
  background: rgba(255, 255, 255, 0.02);
}

.action-banner {
  padding: 12px 14px;
  border-radius: var(--radius);
  border: 1px solid var(--border);
  font-size: 13px;
}

.action-banner.success {
  border-color: rgba(89, 197, 138, 0.22);
  color: #c8f1d8;
  background: rgba(89, 197, 138, 0.08);
}

.action-banner.error {
  border-color: rgba(242, 109, 120, 0.24);
  color: #ffd8dc;
  background: rgba(242, 109, 120, 0.1);
}

.button-secondary {
  background: rgba(255, 255, 255, 0.04);
}

.hero-card {
  display: grid;
  gap: 16px;
  padding: 20px;
  border-radius: var(--radius-lg);
  border: 1px solid rgba(202, 214, 229, 0.12);
  background:
    radial-gradient(circle at top right, rgba(88, 166, 255, 0.1), transparent 34%),
    linear-gradient(180deg, rgba(20, 30, 44, 0.98), rgba(13, 19, 29, 0.98));
  box-shadow: var(--shadow);
}

.hero-topline {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

.panel-tight {
  gap: 10px;
}

.repo-path {
  overflow-wrap: anywhere;
}

.prompt-panel {
  border-color: rgba(88, 166, 255, 0.2);
}

.prompt-message {
  margin: 0;
  padding: 14px;
  border-radius: var(--radius);
  border: 1px solid rgba(202, 214, 229, 0.08);
  background: rgba(7, 11, 17, 0.56);
  color: var(--text-secondary);
  overflow: auto;
  white-space: pre-wrap;
  word-break: break-word;
  font-family: var(--mono);
  font-size: 12px;
  line-height: 1.55;
}

.footer-note {
  color: var(--text-faint);
  font-size: 12px;
}

@media (max-width: 1120px) {
  .summary-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .grid-two {
    grid-template-columns: 1fr;
  }
}

@media (max-width: 860px) {
  .app-shell {
    grid-template-columns: 1fr;
  }

  .sidebar {
    border-right: 0;
    border-bottom: 1px solid var(--border);
  }

  .summary-grid {
    grid-template-columns: 1fr;
  }
}`;
