export const UI_WEB_STYLES_SHELL = `:root {
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
}

.main {
  padding: 28px;
  display: grid;
  align-content: start;
  gap: 24px;
}

.view-toggle-bar {
  display: flex;
  align-items: center;
  justify-content: flex-end;
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

`;
