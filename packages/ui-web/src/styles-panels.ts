export const UI_WEB_STYLES_PANELS = `.grid-two {
  display: grid;
  grid-template-columns: minmax(0, 1.45fr) minmax(340px, 0.95fr);
  gap: 24px;
}

.artifact-grid,
.timeline-grid {
  display: grid;
  gap: 12px;
  align-content: start;
}

.artifact-card,
.timeline-card {
  align-self: start;
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

.collapsible-card {
  overflow: hidden;
}

.collapsible-summary {
  list-style: none;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

.collapsible-summary::-webkit-details-marker {
  display: none;
}

.collapsible-body {
  margin-top: 14px;
}

.debug-summary {
  color: var(--text-faint);
  font-size: 12px;
}

.collapsible-badge {
  opacity: 0.7;
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

.project-shell {
  display: grid;
  grid-template-columns: 300px minmax(0, 1fr);
  gap: 24px;
  align-items: start;
}

.project-toolbar {
  display: flex;
  align-items: center;
  justify-content: flex-start;
}

.project-sidebar,
.project-main,
.project-chat-shell {
  display: grid;
  gap: 16px;
}

.project-run-group {
  display: grid;
  gap: 10px;
}

.project-run-list {
  display: grid;
  gap: 12px;
}

.overview-run-card {
  display: grid;
  gap: 12px;
  width: 100%;
  padding: 16px;
  border-radius: var(--radius-lg);
  border: 1px solid var(--border);
  background: linear-gradient(180deg, rgba(19, 29, 42, 0.94), rgba(15, 22, 32, 0.98));
  box-shadow: var(--shadow);
  color: var(--text);
  text-align: left;
  cursor: pointer;
}

.overview-run-card.active {
  border-color: rgba(88, 166, 255, 0.28);
  background: linear-gradient(180deg, rgba(88, 166, 255, 0.16), rgba(19, 29, 42, 0.98));
}

.overview-run-topline {
  font-size: 16px;
  letter-spacing: -0.02em;
}

.stage-strip {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  align-items: center;
  gap: 12px;
}

.stage-strip-node {
  position: relative;
  display: grid;
  justify-items: center;
  gap: 8px;
}

.stage-strip-node::before {
  content: "";
  position: absolute;
  top: 10px;
  left: calc(-50% + 12px);
  width: calc(100% - 24px);
  height: 2px;
  background: rgba(202, 214, 229, 0.28);
}

.stage-strip-node:first-child::before {
  display: none;
}

.stage-dot {
  width: 22px;
  height: 22px;
  border-radius: 999px;
  border: 2px solid rgba(202, 214, 229, 0.7);
  background: transparent;
  z-index: 1;
}

.stage-strip-node.done .stage-dot {
  background: rgba(89, 197, 138, 0.9);
  border-color: rgba(89, 197, 138, 1);
}

.stage-strip-node.active .stage-dot {
  background: rgba(88, 166, 255, 0.95);
  border-color: rgba(88, 166, 255, 1);
}

.stage-strip-node.waiting .stage-dot {
  background: rgba(217, 164, 65, 0.95);
  border-color: rgba(217, 164, 65, 1);
}

.stage-strip-node.stale .stage-dot {
  background: rgba(242, 109, 120, 0.92);
  border-color: rgba(242, 109, 120, 1);
}

.stage-label {
  font-size: 11px;
  color: var(--text-secondary);
  text-transform: capitalize;
  text-align: center;
}

.project-chat-shell {
  min-height: 68vh;
  border: 1px solid var(--border);
  border-radius: var(--radius-lg);
  background: linear-gradient(180deg, rgba(19, 29, 42, 0.94), rgba(15, 22, 32, 0.98));
  box-shadow: var(--shadow);
  padding: 24px;
  align-content: space-between;
}

.project-chat-body {
  display: grid;
  gap: 16px;
}

.project-chat-title {
  margin: 0;
  font-size: 32px;
  line-height: 1;
  letter-spacing: -0.04em;
}

.project-chat-note {
  margin: 0;
  color: var(--text-secondary);
  font-size: 15px;
  line-height: 1.5;
}

.project-inline-feed .timeline-card {
  background: rgba(255, 255, 255, 0.02);
}

.project-chat-inputRow {
  display: grid;
  grid-template-columns: 1fr auto;
  gap: 12px;
  align-items: center;
}

.project-chat-inputPlaceholder {
  min-height: 58px;
  display: flex;
  align-items: center;
  padding: 0 16px;
  border-radius: var(--radius);
  border: 1px solid rgba(202, 214, 229, 0.12);
  background: rgba(255, 255, 255, 0.02);
  color: var(--text-muted);
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

  .project-shell {
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
