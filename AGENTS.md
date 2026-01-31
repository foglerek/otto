# AGENTS.md - OTTO (Orchestrated Task & Team Operator)

## Overview

Otto is an opinionated agentic workflow harness.

- It converts an ask into durable artifacts (plan/tasks/reports) and orchestrates a reliable execution loop.
- It is designed to be repo-agnostic via adapters and runners published as npm packages.
- It uses Git worktrees for isolation (core invariant).

Current status:

- Early scaffolding: CLI/config/worktree bootstrap exists; full orchestration loop is not implemented yet.

## Runtime Invariants

- Node.js `>= 22`
- TypeScript implementation
- Git worktrees are required
- TypeScript configuration (`otto.config.ts`)
- At least one runner package is required for agentic work

## Repo Layout

- `packages/core` — `@otto/core` (CLI entrypoint + core harness)
- `packages/ports` — `@otto/ports` (shared contracts)
- `packages/config` — `@otto/config` (config types + `defineOttoConfig`)
- `packages/ui-opentui` — `@otto/ui-opentui` (default prompt/TUI)
- `packages/adapter-*` — adapters for repo-specific behavior
- `packages/runner-*` — runner backends (CLIs/SDKs)

Keep the boundary clean:

- `@otto/ports` must stay small and stable.
- `@otto/core` should not embed repo-specific commands; it should call adapters/hooks.

## Philosophy

- **KISS**: Favor simplicity; introduce minimal code that solves the problem.
- **YAGNI**: Don't add features not in requirements; don't preempt future requirements.
- **WET**: Don't abstract before patterns are clear; only abstract if it simplifies overall.
- **DRY**: Re-use existing code paths; refactor rather than duplicate when patterns are clear.
- **Safety first**: This tool touches git state, filesystem, and potentially secrets; defaults must be conservative.

## Rules

### Artifacts

- Otto writes artifacts to `.otto/` by default.
- `.otto/` is treated as ephemeral and should not be committed.
- Worktrees default to `.worktrees/` and should not be committed.

### Config

- Primary config is `otto.config.ts`.
- Prefer strongly typed hooks over shell-script strings.

### Adapters And Runners

- Adapters are packages (e.g., `@otto/adapter-git-worktree`).
- Runners are packages (e.g., `@otto/runner-claude-code`).
- The core harness must not assume a package manager, database, or test framework.

### Development Commands

- Install deps: `bun install`
- Build: `bun run build`
- Run CLI locally: `bun run otto -- --help`
- Bootstrap a worktree (scaffold): `bun run otto -- bootstrap --slug <slug> --ask "..."`

### UI

- OpenTUI is the default prompt UI.
- Dev prerequisite: Zig is required to build OpenTUI dependencies.
- Otto should eventually support headless prompting for CI/non-interactive environments.

## Learnings

- Keep the kernel behavior-focused; treat tooling specifics as adapter implementation detail.
