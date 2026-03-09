# Dogfooding Runbook

This runbook operationalizes Stage 1 (smoke parity) and Stage 2 (failure-mode parity)
from `docs/parity-and-dogfooding-plan.md`.

## Scope And Invariants

- Compare Otto against legacy behavior for representative tickets.
- Preserve per-task execution order invariant:
  - `implementation -> deterministic quality checks -> review -> lead decision`
- Parallelism experimentation (if any) is only across independent tasks, not within one task loop.

## Stage 1 - Side-By-Side Smoke Parity

### Ticket Set

Select 5-10 tickets that cover:

1. straightforward feature task
2. bug-fix task with failing tests pre-fix
3. task requiring remediation path at least once
4. task with multi-file edits and review rewrite
5. task with integration checks enabled

### Execution Pattern

For each ticket, run both systems in isolated worktrees and record:

- phase progression
- terminal outcome class (`success`, `remediation`, `failed`)
- required artifacts present (`plan`, `tasks`, `report`, `review`, `summaries`, `final report`)
- safety outcomes (merge/cleanup anomalies)

### Evidence Template

Use one entry per system run:

```text
ticket: <id>
system: legacy|otto
run_id: <id>
outcome: success|remediation|failed
phase_trace: <phase list>
artifacts_ok: yes|no
safety_incident: none|<details>
notes: <optional>
```

### Stage 1 Exit Criteria

- All selected tickets have both legacy + Otto entries.
- Terminal outcome class parity holds for each ticket.
- Required artifact presence parity holds for each ticket.
- No unresolved P0/P1 safety incidents.

## Stage 2 - Failure-Mode Parity Battery

Run targeted scenarios and capture behavior/evidence:

1. merge already in progress with unresolved conflicts
2. merge failure after autostash
3. stash-restore failure after successful merge
4. wrong-directory artifact outputs requiring recovery
5. context-overflow recovery paths in lead/runner flows

For each scenario, record:

- expected safety behavior
- observed Otto behavior
- pass/fail
- remediation task creation details (if expected)

### Stage 2 Exit Criteria

- Every scenario has a deterministic pass/fail record.
- Failing scenarios have an issue or remediation plan linked.
- Zero untriaged safety divergences.

## Tracking

Maintain a single parity log (markdown table or structured text) in this repo and
link it from `.internal/otto/TODO.md` while dogfooding is active.
