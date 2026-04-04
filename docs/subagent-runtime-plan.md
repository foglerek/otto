# Subagent Runtime Plan

This document maps the missing runtime pieces for safe cross-task parallelism.

Hard invariant:

- One task loop remains sequential:
  `implementation -> deterministic quality checks -> review -> lead decision`
- Parallelism is only across independent task loops.

## Current Runtime Shape

Today Otto runs one shared execution loop per run:

- one run-level worktree in `packages/core/src/state.ts`
- one shared queue in `packages/core/src/workflow/task-queue.ts`
- one shared runtime in `packages/core/src/workflow/runtime.ts`
- one shared task loop in `packages/core/src/workflow/task-loop.ts`
- one run lock in `packages/core/src/locks/run-lock.ts`

This is solid for sequential execution, but it is not safe to fan out multiple task workers yet.

## Missing Primitives

### 1. Structured task scheduling inputs

Otto needs machine-readable data that tells the scheduler which tasks are blocked, independent, or serialized.

Required additions:

- planner/lead output that marks task dependencies explicitly
- a stable task metadata shape beyond filename ordering
- queue semantics that distinguish pending, claimed, running, blocked, completed, and failed tasks

Primary integration points:

- `packages/core/src/workflow/phases/task-splitting.ts`
- `packages/core/src/workflow/phases/task-feedback.ts`
- `packages/core/src/workflow/phases/user-feedback.ts`
- `packages/core/src/workflow/integration/remediation-task.ts`
- `packages/core/src/workflow/task-metadata.ts`

### 2. Per-task worktree isolation

Parallel task workers cannot safely share the current single run worktree.

Required additions:

- allocate one task-scoped worktree per active worker
- track each task worktree in state
- merge accepted task branches back into the run's integration branch deterministically
- clean up task worktrees conservatively on success, failure, and resume

Primary integration points:

- `packages/core/src/runs/state.ts`
- `packages/core/src/state.ts`
- `packages/adapter-git-worktree/src/index.ts`
- `packages/core/src/cleanup.ts`
- `packages/core/src/cli/post-run-merge-back.ts`

### 3. Multi-worker state and leases

The current state store is single-writer oriented and only tracks a run-level lock.

Required additions:

- task claim/lease records with worker identity and heartbeat timestamps
- per-task session maps, per-task worktree metadata, and worker status in state
- safe resume semantics for interrupted workers
- explicit state transitions for claim, release, completion, and recovery

Primary integration points:

- `packages/core/src/state.ts`
- `packages/core/src/workflow/state-store.ts`
- `packages/core/src/workflow/state-reducer.ts`
- `packages/core/src/locks/run-lock.ts`

### 4. Scheduler and worker runtime factory

The current execution phase is a single serial `while` loop.

Required additions:

- a scheduler that dispatches only unblocked tasks
- enforcement of `subagents.maxConcurrent`
- worker runtime construction that can use `config.subagents.byRole`
- worker cancellation/retry/requeue boundaries that preserve current task-loop invariants

Primary integration points:

- `packages/core/src/run.ts`
- `packages/core/src/workflow/runtime.ts`
- `packages/core/src/workflow/phases/execution.ts`
- `packages/core/src/workflow/task-loop.ts`
- `packages/config/src/index.ts`

### 5. Worker-safe prompting and coordination

Parallel workers cannot prompt independently without conflicting UI/state behavior.

Required additions:

- one coordinator-owned prompt path for user-facing decisions
- task workers that surface requests/events rather than prompting directly
- stateful pause/resume when user input is required

Primary integration points:

- `packages/core/src/workflow/task-loop.ts`
- `packages/core/src/workflow/phases/user-feedback.ts`
- `packages/core/src/workflow/phases/integration.ts`
- `packages/core/src/state.ts`

### 6. Task-worker telemetry and hooks context

Current telemetry is run-centric, not worker-centric.

Required additions:

- events for task claimed, worker started, worker heartbeat, task completed, task merged, task requeued
- task/worker/worktree identifiers in telemetry
- hook contexts that include worker and task metadata

Primary integration points:

- `packages/core/src/workflow/events.ts`
- `packages/core/src/workflow/hooks.ts`
- `packages/ports/src/index.ts`

## Suggested Delivery Order

1. Add structured task dependency metadata and scheduling eligibility.
2. Add per-task worktree allocation and mergeback primitives.
3. Extend state/locks/reducer for worker leases and per-task metadata.
4. Build the scheduler that honors `subagents.maxConcurrent`.
5. Add prompt arbitration and worker-safe pause/resume behavior.
6. Expand telemetry and hook context for multi-worker visibility.

## Explicit Non-Goals

- No parallelism inside a single task loop.
- No free-form role fan-out inside `implementation -> quality -> review -> lead decision`.
- No relaxation of `.otto` artifact location rules.
