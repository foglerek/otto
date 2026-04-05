# AG-UI OpenCode SDK Plan

This document covers the remaining SDK-streaming blocker: `@otto/runner-opencode-sdk`.

## Why This Runner Is Different

The other SDK runners can move from:

- `request -> final response`

to:

- `request -> provider stream`

But OpenCode's natural streaming model is different.

The documented SDK/server shape is:

- create or attach to an OpenCode server/client
- create/use a session
- subscribe to the server event stream
- send a prompt to a specific session
- observe session/bus events while the session runs

That means the cleanest OpenCode SDK streaming implementation is session/event-oriented rather than a simple `run(prompt) -> stream` API.

## Recommended Architecture

`@otto/runner-opencode-sdk` should gain a session-scoped streaming mode that:

1. creates or resolves the target OpenCode session
2. subscribes to the event stream before sending the prompt
3. filters events to the current session/message scope
4. emits AG-UI events from those native session events in real time
5. awaits terminal completion for the prompt
6. returns the normalized final `OttoRunnerResult`

Core still owns:

- AG-UI persistence to `ag-ui-events.jsonl`
- replay
- server/UI proxying

## Proposed Runner Shape

Extend the OpenCode SDK runner client assumptions from just:

- `run(...)`
- `responses.create(...)`

to optionally support a session/event client shape, for example:

- `session.create(...)` or equivalent
- `session.prompt(...)` or equivalent
- `event.subscribe()` or equivalent SSE stream

The runner should prefer this event-driven path when available.

## Event Handling Model

### Before prompting

The runner should:

- create a dedicated session or reuse a passed session id
- open the event stream first
- establish a filter for the target session id

### During prompt execution

Map session events to AG-UI directly:

- message/text parts -> `TEXT_MESSAGE_*`
- tool events -> `TOOL_CALL_*`
- reasoning/thought-like events -> custom or reasoning AG-UI events if clearly exposed
- keep raw native event passthrough too

### Completion

The runner should stop consuming once the prompt reaches a terminal condition for that session/message.

Return value still includes:

- `success`
- `outputText`
- `sessionId`
- timeout / overflow detection

## Filtering Requirements

This is the critical implementation risk.

The event stream is likely bus-like, so the runner must reliably filter by:

- session id
- and, if needed, message id / prompt invocation boundary

Without that, concurrent prompts could bleed into each other.

## Suggested Rollout

1. Prove session-scoped event filtering with a minimal harness.
2. Emit assistant text AG-UI events only.
3. Add tool-call mappings.
4. Decide whether any OpenCode-native reasoning/thought signals should become AG-UI reasoning events.

## Exit Criteria

Good enough for v1:

1. session-scoped streamed assistant text events
2. raw native event passthrough
3. no cross-session event leakage
4. fallback to current coarse path if streaming/session APIs are unavailable

## Current Blocker

This runner required:

- a different session/event-subscription architecture than the other SDK runners
- careful event filtering by session/message scope

That dedicated slice is now implemented in the runner:

- it prefers a session/event-subscription client shape when available
- it filters events by session id
- it emits AG-UI assistant text and tool-call lifecycle from session event updates
- it falls back to the older coarse response path when only that API surface is available

Remaining risk:

- this path is tested with fake clients and documented server event shapes, but still deserves real-world dogfooding validation against the actual OpenCode SDK/server before release.
