# AG-UI SDK Streaming Plan

This document defines the cleanest next step for richer AG-UI semantics on SDK-backed runners.

## Problem

The SDK-backed runners currently use non-streaming request APIs.

That means they can only emit:

- final assistant-message AG-UI events
- coarse success/error metadata

They cannot currently emit rich live AG-UI semantics like:

- incremental assistant text
- streamed reasoning/thinking
- tool-call lifecycle in real time

So the next step is not more post-hoc mapping. It is adopting each provider's streaming API.

## Recommendation

Use a provider-specific streaming path inside each SDK runner and normalize the resulting stream into AG-UI events directly in the runner.

Core remains responsible for:

- collecting runner `onEvent` callbacks
- persisting `ag-ui-events.jsonl`
- replaying/serving those events to CLI or web consumers

The web server stays a thin run-scoped proxy.

## Package-by-Package Plan

### `@otto/runner-claude-sdk`

Recommended API:

- `client.messages.create({ ..., stream: true })`
  or
- `client.messages.stream(...)`

Best fit:

- prefer `messages.create({ stream: true })` if we want minimal abstraction and direct raw event control
- prefer `messages.stream(...)` if the helper exposes the exact text/tool/thinking hooks we want with low risk

AG-UI mapping target:

- `content_block_delta.text_delta` -> `TEXT_MESSAGE_CONTENT`
- text block start/stop -> `TEXT_MESSAGE_START` / `TEXT_MESSAGE_END`
- `tool_use` content blocks with `input_json_delta` -> `TOOL_CALL_START` / `TOOL_CALL_ARGS`
- tool result turn handling depends on how we decide to run tools in Otto; if tools remain external to the SDK runner, keep as custom/raw until needed
- `thinking` stream/helper callbacks -> `THINKING_*` or AG-UI reasoning events if we adopt them

Recommended rollout:

1. incremental text first
2. raw stream event passthrough
3. reasoning/tool semantics second

### `@otto/runner-codex-sdk`

Recommended API:

- OpenAI Responses API with `stream: true`

AG-UI mapping target:

- `response.output_text.delta` -> `TEXT_MESSAGE_CONTENT`
- output item added/done -> message/tool start/end boundaries
- `response.function_call_arguments.delta` and related function/tool events -> `TOOL_CALL_ARGS`
- completed function/tool-call output items -> `TOOL_CALL_END` / `TOOL_CALL_RESULT`
- reasoning events, if available for the chosen model/endpoint -> reasoning/thinking AG-UI events

Recommended rollout:

1. incremental text deltas
2. raw stream event passthrough
3. tool-call lifecycle
4. reasoning events if the stream shape is stable enough

### `@otto/runner-google-genai`

Recommended API:

- `ai.models.generateContentStream(...)`

AG-UI mapping target:

- streaming text chunks -> `TEXT_MESSAGE_CONTENT`
- chunk boundaries -> message start/end
- function/tool call parts if present in streamed candidates -> AG-UI tool-call lifecycle
- thought/reasoning parts only if the SDK exposes them clearly enough

Recommended rollout:

1. incremental text streaming
2. raw chunk passthrough
3. tool semantics if clearly present in chunk structure

### `@otto/runner-opencode-sdk`

Recommended API direction:

- do not force the current request/response path to pretend to be streaming
- prefer the SDK/server event subscription path if it can be scoped to the active session

Why this one is different:

- OpenCode already has an event bus / SSE subscription model
- its natural streaming shape may be "prompt a session, then subscribe to that session's events"

AG-UI mapping target:

- subscribe to session-scoped server events
- convert session message/tool records to AG-UI directly in the runner or a runner-local adapter
- keep raw native event passthrough too

Recommended rollout:

1. prove that we can safely scope streamed events to the current session
2. map assistant text
3. map tool lifecycle

## Not Worth Doing Yet

- no attempt to unify all provider stream implementations behind a giant shared streaming abstraction before the first runner migrates
- no deep core refactor required before the SDK runners can stream
- no requirement that every SDK runner ships reasoning semantics in the first streaming pass

## Suggested Execution Order

1. `claude-sdk`
2. `codex-sdk`
3. `google-genai`
4. `opencode-sdk`

Rationale:

- Anthropic and OpenAI have the clearest documented streaming semantics for our current AG-UI goals
- Google is likely straightforward for text streaming, but tool/reasoning semantics need confirmation
- OpenCode SDK probably wants a more session/event-oriented implementation than the others

## Exit Criteria For Each Runner

A runner streaming migration is good enough when it provides:

1. streamed assistant text AG-UI events
2. raw native event preservation when available
3. no regression in final result parsing / timeout / overflow behavior
4. persisted `ag-ui-events.jsonl` replay works unchanged through core
