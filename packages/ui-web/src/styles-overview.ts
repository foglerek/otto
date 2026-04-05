export const UI_WEB_STYLES_OVERVIEW = `.project-shell {
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

.run-progress-strip {
  display: flex;
  align-items: start;
  justify-content: center;
  gap: 12px;
  overflow: auto;
  padding: 8px 0 4px;
}

.run-progress-segment {
  min-width: 172px;
  display: grid;
  gap: 10px;
  padding: 14px;
  border-radius: var(--radius-lg);
  border: 1px solid rgba(202, 214, 229, 0.12);
  background: rgba(255, 255, 255, 0.02);
}

.run-progress-current {
  background: linear-gradient(180deg, rgba(88, 166, 255, 0.14), rgba(255, 255, 255, 0.02));
  border-color: rgba(88, 166, 255, 0.28);
}

.run-progress-done {
  border-color: rgba(89, 197, 138, 0.2);
}

.run-progress-line {
  display: flex;
  align-items: center;
  gap: 8px;
}

.run-progress-dot {
  width: 18px;
  height: 18px;
  border-radius: 999px;
  border: 2px solid rgba(202, 214, 229, 0.7);
  background: transparent;
}

.run-progress-done .run-progress-dot {
  background: rgba(89, 197, 138, 0.95);
  border-color: rgba(89, 197, 138, 1);
}

.run-progress-current .run-progress-dot {
  background: rgba(88, 166, 255, 0.95);
  border-color: rgba(88, 166, 255, 1);
}

.run-progress-connector {
  flex: 1;
  height: 2px;
  background: rgba(202, 214, 229, 0.28);
}

.run-progress-label {
  margin: 0;
  font-size: 13px;
  color: var(--text-secondary);
  text-transform: capitalize;
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
