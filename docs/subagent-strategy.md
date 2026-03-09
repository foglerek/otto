# Subagent Strategy

Otto supports a strategy section for subagent routing in `otto.config.ts`:

```ts
subagents: {
  enabled: true,
  maxConcurrent: 2,
  byRole: {
    task: createCodexCliRunner(),
    reviewer: createClaudeCodeRunner(),
  },
}
```

Current intent:

- `enabled`: controls whether subagent execution is allowed.
- `maxConcurrent`: concurrency budget for delegated subagent units.
- `byRole`: role-scoped runner routing for delegated work.

This strategy layer is currently a configuration contract and onboarding surface.
Execution-level subagent orchestration will be integrated in follow-up workflow slices.
