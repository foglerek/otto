# UI Web Plan

This document scopes the primary operator UX after the current CLI-first phase.

## Product Direction

- Primary operator surface: local web app
- TUI: fallback/minimal only; not the main product investment path
- Native desktop: later, via a Tauri wrapper around the web app
- Initial deployment model: local-only, single-operator control plane for one repository at a time

## Why This Direction

The current OpenTUI layer is good enough for prompt collection and a basic start screen, but it is not the right long-term surface for:

- monitoring active runs
- browsing artifacts, tasks, and reports
- viewing live exec telemetry
- resuming and recovering work without losing context
- managing prompts and approvals in a durable, inspectable way

Otto already has strong filesystem-backed state under `.otto/` and `.worktrees/`. A web control plane can expose that state much more effectively than a terminal UI.

## UX Goals

The web app should let an operator:

1. Create or ingest tickets quickly.
2. Start, resume, delete, and merge back runs without terminal-only workflows.
3. See active/inactive runs, current phase, and task progress at a glance.
4. Inspect artifacts, telemetry, and failures in one place.
5. Respond to Otto prompts from the browser instead of a TTY.
6. Keep the CLI available for automation, scripting, and fallback use.

## Design Direction

- Personality: precision + utility
- Tone: developer control plane, information-dense, calm, low-chrome
- Foundation: cool neutrals with one restrained accent color
- Layout: sidebar + list/detail + event timeline
- Typography: modern sans for UI, monospace for run IDs, phases, commands, and timestamps

This should feel closer to Linear/GitHub/Vercel control surfaces than to a wizard-heavy setup flow.

## MVP Surface Area

### 1. Dashboard

- repo status card
- onboarding/config status
- active runs list
- inactive runs list
- latest failures / stale runs / merge-back-needed runs

### 2. Tickets

- create ticket from freeform text
- ingest external markdown file
- amend ticket before start
- list managed tickets and whether they already have runs

### 3. Run Detail

- header: run ID, ticket slug, branch, base branch, created time, process status
- phase timeline
- current task / queue summary
- live exec event feed
- artifact tabs:
  - plan
  - decision cards
  - tasks
  - reviews
  - summaries
  - final report
- actions:
  - resume
  - delete
  - merge back
  - restart task / skip / abort when applicable

### 4. Prompt Inbox

- browser-rendered `confirm`, `text`, and `select` prompts
- durable prompt state for reconnect/reload safety
- clear indication of which run/phase is waiting on input

### 5. Onboarding / Config

- show onboarding results and missing prerequisites
- display active config path and key configured behaviors
- defer config editing UX if needed; initial version can be read-only plus “open file” guidance

## Recommended Architecture

## Packages

- `@otto/ui-web`
  - React + TypeScript web app
  - router, data fetching, prompt UI, artifact views, live run views
- `@otto/ui-web-server`
  - local-only HTTP server + SSE/WebSocket bridge
  - serves the UI and exposes Otto APIs
- `@otto/core`
  - remains the harness and source of truth for workflow behavior
  - should grow a reusable service layer so CLI and web server call the same operations
- later: Tauri wrapper package/app

## Core Principle

Do not make the web app scrape terminal output.

Instead:

- extract core operations into service functions
- have both CLI handlers and the web server call those services
- keep `.otto/` as the durable storage layer
- stream structured events to the browser

## Service Layer Extraction

Current command handlers in `packages/core/src/cli/commands/*.ts` mix:

- input parsing
- prompt/UI behavior
- filesystem/run orchestration
- terminal output shaping

For the web workstream, extract a service layer in `@otto/core`, for example:

- `listRuns`
- `getRunDetail`
- `createTicket`
- `ingestTicket`
- `amendTicket`
- `startRun`
- `resumeRun`
- `deleteRun`
- `runOnboarding`
- `getConfigSummary`
- `maybeRunMergeBack`

CLI handlers should become thin wrappers over those services.

## Prompt Bridge

This is the key enabling piece.

Otto already has an `OttoPromptAdapter` abstraction in `@otto/ports`. The web stack should implement a server-owned prompt bridge that surfaces prompt requests in the browser UI instead of introducing a separate prompt system.

Important architecture clarification:

- the browser is only the UI surface
- the local server is the control plane
- `@otto/core` still owns workflow execution and runner orchestration
- `.otto/` remains the durable source of truth for run/workflow state
- if the web server exits, active workflows may stop and later resume from Otto state; exact in-flight continuation is not a requirement

Short term:

- bridge the existing `OttoPromptAdapter` model on the server so browser-driven `start` / `resume` can work soon

Medium term:

- support multiple concurrent server-managed workflows by routing events/prompts to the correct Otto process or in-process run handle

Longer term / optional:

- if needed later, add more explicit control-plane state or a lightweight server DB for richer coordination

Recommended flow:

1. A server-owned Otto job needs `confirm`, `text`, or `select`.
2. The server records a pending prompt request.
3. The browser renders that request in a persistent prompt inbox/modal.
4. The user responds to the server.
5. The server resolves the prompt promise and core execution continues.

Requirements:

- one prompt coordinator per local repo session
- prompt persistence across browser reloads/reconnects
- visible waiting state in the run detail page
- no background worker should ever try to prompt directly to a TTY in web mode
- the server, not the browser, remains the owner of run/job lifecycle

## Live Updates

Otto already writes durable run telemetry to:

- `.otto/runs/<runId>/events.jsonl`
- `.otto/runs/<runId>/exec.jsonl`
- `.otto/states/*.json`

Use that instead of inventing a second state model.

Recommended server behavior:

- read state from `.otto/` on demand
- watch relevant files/directories for changes
- normalize updates into structured run summaries
- stream incremental updates to the browser

Current progress:

- local SSE stream endpoint now pushes dashboard updates, control-plane updates, and selected-run detail updates to the browser
- browser still keeps a long-interval fallback refresh, but live updates now come primarily from the server stream instead of tight polling
- per-run AG-UI event streams are now a first-class direction for agent/session events, with Otto emitting `ag-ui-events.jsonl` in each run folder and the server exposing `/api/runs/:runId/ag-ui`
- current AG-UI mapping uses core lifecycle/exec/custom Otto events, and now also captures raw runner-native logs where the runner exposes them
- current runner-native capture is partial: `claude-code`, `codex-cli`, and `opencode-cli` now forward raw parsed lines into AG-UI `RAW` events; broader runner coverage remains ahead
- the current web UI now subscribes to the selected run's AG-UI stream and renders a basic event feed alongside artifact/detail views

This gives the browser a real-time feel without changing Otto's storage model.

## Durability Model

The current product requirement is intentionally simple:

- the browser should stay dumb
- the server should be the glue between UI and Otto
- Otto's persisted state under `.otto/` is already good-enough recovery state
- if the server dies, workflows can be resumed from Otto state even if some checks replay

This means the web stack does not currently need exact mid-prompt or mid-step continuation semantics.

## API Shape

Suggested local API surface:

- `GET /api/status`
- `GET /api/config`
- `GET /api/onboarding`
- `GET /api/tickets`
- `POST /api/tickets/create`
- `POST /api/tickets/ingest`
- `POST /api/tickets/:ticketId/amend`
- `GET /api/runs`
- `GET /api/runs/:runId`
- `GET /api/runs/:runId/ag-ui`
- `POST /api/runs/start`
- `POST /api/runs/:runId/resume`
- `POST /api/runs/:runId/delete`
- `POST /api/runs/:runId/merge-back`
- `GET /api/runs/:runId/artifacts/:name`
- `GET /api/stream`

Keep this local-only and intentionally narrow.

## Launch Model

Short term:

- add `otto web` to start the local server and open the browser

Longer term:

- wrap the same web app/server flow in Tauri for desktop packaging

This preserves a scriptable CLI while making the operator experience browser-first.

## Delivery Phases

### Phase 1: Core extraction + read-only dashboard

- extract core service functions from CLI handlers
- add `@otto/ui-web-server`
- add `@otto/ui-web` shell app
- ship dashboard, runs list, run detail, artifact viewers, config/onboarding status

Exit criteria:

- operator can inspect run state and artifacts without using the TTY dashboard

### Phase 2: Browser actions

- create ticket
- ingest ticket
- start run
- resume run
- delete run
- merge back

Current progress:

- `create ticket` is now wired through the browser to shared core services.
- `ingest ticket` now supports both pasted/typed markdown and uploaded file contents sent through the ingest flow.
- `delete run` is now wired through the browser to shared core services.
- `start`, `resume`, and `merge back` now run through a server-owned web job/control-plane substrate.
- the short-term prompt bridge is now live: the server keeps pending prompt state in memory and the browser submits prompt responses back to the server.

Exit criteria:

- operator can perform the standard run lifecycle from the browser

### Phase 3: Prompt bridge

- implement server-owned prompt bridge backed by `OttoPromptAdapter`
- surface prompt inbox and waiting states
- ensure reconnect-safe prompt handling

Current progress:

- server-owned prompt bridge is implemented for the current local web session
- browser prompt inbox/waiting states are implemented
- control-plane job/prompt snapshot now persists to `.otto/states/web-control-plane.json`
- on server restart, incomplete web jobs are surfaced as failed instead of silently disappearing
- a first control-plane-state step is now in place: tracked prompt adapters toggle `workflow.needsUserInput` in persisted run state during prompt waits
- deeper explicit pending-action refactors are now optional, not required for the current UX model
- the server now supports concurrent web-managed Otto jobs across different runs and routes prompts by `promptId` / `runId` instead of enforcing a single interactive job for the whole server session

Exit criteria:

- no interactive TTY is required for normal browser-driven operation

### Phase 4: Live oversight

- live phase transitions
- exec timeline
- failure surfaces
- recovery controls
- artifact diffs / review ergonomics as needed

Current progress:

- server-side SSE stream now covers dashboard/control-plane/selected-run updates
- browser shows concurrent job state, multi-prompt inbox, and stream connection status
- per-run AG-UI event stream now exists for richer agent/session rendering independent of the dashboard snapshot stream

Exit criteria:

- browser is the preferred operational surface for active work

### Phase 5: Tauri wrapper

- package the web app as a desktop app
- keep local-only semantics
- avoid cloud/backend complexity unless explicitly needed later

## Explicit Non-Goals

- multi-user shared remote web app
- hosted Otto service
- replacing `.otto/` with a database
- removing the CLI
- investing further in OpenTUI as the primary oversight UI

## Key Risks

- prompt/reconnect handling is the hardest interaction problem
- long-running run execution may need careful server lifecycle management
- service extraction must not fork workflow behavior between CLI and web paths
- live updates must stay faithful to `.otto/` as the source of truth

## First Recommended Implementation Slice

Start with Phase 1 plus the service extraction groundwork:

1. extract read-oriented core services
2. add `otto web` entrypoint
3. build a read-only runs dashboard in `@otto/ui-web`
4. render artifacts and live-updating event timelines from `.otto/`

That delivers immediate UX value before the prompt bridge and action workflows land.

## Current Uncertainty Boundary

The current short-term bridge is intentionally minimal.

- concurrent jobs across different runs are now supported
- duplicate active jobs for the same run are still blocked
- persisted job state survives server restart, but interrupted jobs are failed rather than resumed
- core already has good-enough persisted workflow state for coarse resume semantics

That makes the next logical slices:

1. keep the browser dumb and continue routing prompts/events/responses through the server to the correct run/process
2. improve live oversight ergonomics for multiple concurrent workflows
   - broaden live streaming beyond the currently selected run
   - stream richer per-run event/exec slices instead of refreshing whole run-detail payloads
   - expand runner-native JSON event capture beyond the current initial CLI coverage
3. optionally add lightweight server persistence (for example SQLite) only if coordination actually needs it
