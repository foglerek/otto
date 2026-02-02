# Otto

![otto logo](./logo.png)

Otto is an opinionated, extensible agentic workflow harness. It turns a user ticket into a durable set of artifacts (plans, tasks, reports) and orchestrates a reliable loop over them.

Core design constraints:

- Node.js `>= 22`
- TypeScript implementation
- Git worktrees for isolation (required)
- TypeScript configuration (`otto.config.ts`)
- At least one agent runner is required (runners are shipped as packages)

This repo is a Turborepo monorepo. Adapters and runners are npm packages so consumers can swap behavior without forking Otto.

## Repo Layout

- `packages/core` — `@otto/core` (CLI entrypoint + core harness)
- `packages/ports` — `@otto/ports` (shared interfaces/types)
- `packages/config` — `@otto/config` (TypeScript config contracts + helpers)
- `packages/ui-opentui` — `@otto/ui-opentui` (default TUI/prompt adapter)
- `packages/adapter-git-worktree` — `@otto/adapter-git-worktree` (worktree operations)
- `packages/adapter-quality-commands` — `@otto/adapter-quality-commands` (quality gate = command checklist)
- `packages/runner-echo` — `@otto/runner-echo` (minimal local runner)
- `packages/runner-claude-code` — `@otto/runner-claude-code` (scaffolded runner)

## Artifacts

Otto writes run artifacts to `.otto/` (tickets, logs, states, etc.).

By default, this repo also places git worktrees in `.worktrees/`.

Both are intentionally ignored by git.

## Prerequisites

- `bun`
- `git`
- `zig` (required to build OpenTUI dependencies during development)

## Local Development

Install + build:

```bash
bun install
bun run build
```

Run the CLI locally:

```bash
bun run otto -- --help
```

Bootstrap a worktree + artifact root (scaffold):

```bash
bun run otto -- bootstrap --slug smoke-test --ticket "Bootstrap smoke test"
```

## Status

The repo is currently in an early scaffolding phase:

- CLI wiring, config loading, and worktree bootstrap exist.
- The full task/plan orchestration loop is not implemented yet.
