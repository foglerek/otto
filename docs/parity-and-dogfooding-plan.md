# Parity And Dogfooding Plan

This document tracks the current differential parity status against the legacy task manager extraction and defines the replacement dogfooding loop for cutover.

Execution details for Stage 1 and Stage 2 are in `docs/dogfooding-runbook.md`.

## Current Status

Completed high-impact parity slices:

- Runner ecosystem parity (CLI + SDK runners)
- First-class task recovery controls in execution loop
- Configurable retry/attempt policy for key workflow paths
- Integration merge/remediation safety contract tests
- Adapter-level worktree process eviction before cleanup
- Workflow lifecycle hook model (phase and step hooks)
- Release publish policy hardening and release-mode gating
- Binary installer path (`curl | bash`)
- Initial onboarding command + subagent strategy contract/docs

Remaining release-impact gaps:

1. Execute the full replacement dogfooding loop and close parity with real ticket runs.
2. Implement cross-task subagent orchestration (strategy exists; runtime scheduler and per-task isolation are still pending).

Note: per-task execution remains sequential by invariant:
`implementation -> deterministic quality checks -> review -> lead decision`.

## Dogfooding Replacement Loop

### Stage 0 - Freeze contract

- Build parity matrix from extracted spec/tests to Otto behavior.
- Exit criteria:
  - 100% critical contracts mapped to Otto tests or accepted deviations.
  - Deviations recorded in a single parity decision log.

### Stage 1 - Side-by-side smoke runs

- Run representative tickets through legacy and Otto in isolated worktrees.
- Exit criteria:
  - Phase progression parity per ticket.
  - Terminal outcome parity (success/remediation/failure class).
  - Required artifact presence parity.

### Stage 2 - Failure-mode battery

- Force edge cases: merge-in-progress, stash restore failure, wrong-directory artifacts, context overflow.
- Exit criteria:
  - Otto passes merge safety contracts and remediation fallback behavior.
  - Zero untriaged safety divergences.

### Stage 3 - Shadow replacement in jarvis

- Run Otto in shadow where legacy path remains source of truth.
- Exit criteria:
  - 20 consecutive shadow runs without P0/P1 regressions.
  - Resume/recovery behavior verified on interrupted runs.

### Stage 4 - Active cutover

- Promote Otto as default path; keep temporary fallback.
- Exit criteria:
  - Agreed soak window (time or run-count) without unresolved safety incidents.
  - Throughput and success rate remain within agreed baseline bands.

### Stage 5 - Legacy decommission

- Remove default legacy entrypoint and publish migration notes.
- Exit criteria:
  - Fallback removed (or explicitly sunset with date).
  - Parity audit marked closed.
