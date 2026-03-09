# Subagent Strategy

Otto supports a strategy section for subagent behavior in `otto.config.ts`:

```ts
subagents: {
  enabled: true,
  maxConcurrent: 2,
  byRole: {
    task: createCodexCliRunner(),
  },
}
```

Execution invariant (must remain true):

- A single task loop is always sequential:
  `implementation -> deterministic quality checks -> review -> lead decision`.
- Subagent support must not parallelize steps inside one task loop.

Current intent of the strategy fields:

- `enabled`: allows runtime to opt into cross-task parallel execution.
- `maxConcurrent`: maximum number of independent task loops run in parallel.
- `byRole`: initial routing scaffold for delegated task workers (not in-loop role fan-out).

Planned implementation scope:

- Parallelism is across independent tasks only (multiple task loops side-by-side).
- Required prerequisites:
  - per-task worktree isolation
  - dependency-aware task scheduling
  - lead/planner guidance to mark tasks as parallelizable vs serialized

Current status:

- This remains a config contract + onboarding surface.
- Runtime orchestration for cross-task parallel loops is not implemented yet.
