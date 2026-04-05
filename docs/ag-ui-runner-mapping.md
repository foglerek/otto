# AG-UI Runner Mapping

This document tracks how each Otto runner maps its native output into AG-UI events.

## Current Priorities

Short-term dogfooding focus:

1. `claude-code`
2. `codex-cli`

These two runners are the most important near-term validation targets for real runs.

## Coverage Matrix

Legend:

- `native` - emitted directly from runner-native stream/response semantics
- `translated` - derived from Otto/core lifecycle or coarse runner output
- `raw` - preserved in AG-UI `RAW` events
- `pending` - not mapped yet

| Runner | Assistant text | Tool calls | Reasoning | Raw native events | Notes |
| --- | --- | --- | --- | --- | --- |
| `claude-code` | native live | native live | pending | yes | Uses `assistant` tool_use + `user` tool_result records from `stream-json`; final `result` is deduped against live text. |
| `codex-cli` | native live | native live | pending | yes | Uses `item.started/item.completed` `command_execution` records plus `agent_message` records from `codex exec --json`. |
| `opencode-cli` | native live | native live | pending | yes | `tool_use` records carry completed bash tool state and now map to AG-UI tool-call events. |
| `gemini-cli` | native live | native live | pending | yes | `tool_use` / `tool_result` records now map to AG-UI tool-call events. |
| `ollama` | final only | pending | pending | no | Emits final assistant text event from parsed output. |
| `claude-sdk` | final only | pending | pending | no | Emits final assistant text event from SDK response. |
| `codex-sdk` | final only | pending | pending | no | Emits final assistant text event from SDK response. |
| `google-genai` | final only | pending | pending | no | Emits final assistant text event from SDK response. |
| `opencode-sdk` | final only | pending | pending | no | Emits final assistant text event from SDK response. |

## Direct CLI Findings

### `claude-code`

Observed from direct invocation with `claude -p --verbose --output-format stream-json`:

- `system` init event
- `assistant` message records with `content` entries including:
  - `text`
  - `tool_use` with `id`, `name`, `input`
- `user` message records with `tool_result` entries including `tool_use_id`
- final `result` record

Current mapping:

- `assistant.content[].text` -> `TEXT_MESSAGE_*`
- `assistant.content[].tool_use` -> `TOOL_CALL_START` + `TOOL_CALL_ARGS`
- `user.content[].tool_result` -> `TOOL_CALL_END` + `TOOL_CALL_RESULT`
- final `result` -> fallback assistant text if needed

### `codex-cli`

Observed from direct invocation with `codex exec --json`:

- `thread.started`
- `turn.started`
- `item.started` / `item.completed` for `command_execution`
- `item.completed` for `agent_message`
- `turn.completed`

Current mapping:

- `item.started.command_execution` -> `TOOL_CALL_START` + `TOOL_CALL_ARGS`
- `item.completed.command_execution` -> `TOOL_CALL_END` + `TOOL_CALL_RESULT`
- `item.completed.agent_message` -> `TEXT_MESSAGE_*`

## Next Mapping Targets

1. Validate `claude-code` and `codex-cli` semantics during real dogfooding runs.
2. Validate `opencode-cli` and `gemini-cli` tool semantics on real runs now that they have live tool-call mappings.
3. Decide whether any native records should become `REASONING_*` events.
4. Decide whether SDK runners need richer semantics than final assistant text for v1.

## Current Boundary / Blocker

The remaining semantic gap is mostly on SDK-backed runners.

- current SDK integrations call non-streaming request APIs and only receive a final response object
- that is sufficient for final assistant-message AG-UI events
- it is not sufficient for richer live semantics like streamed reasoning, incremental text, or tool-call lifecycle without changing the SDK integration approach

So the next meaningful step for richer SDK semantics is not more mapping logic; it is a product/implementation choice to adopt streaming SDK APIs where each provider supports them.

Streaming adoption plan reference: `docs/ag-ui-sdk-streaming-plan.md`

## Additional CLI Findings

### `opencode-cli`

Observed from direct invocation with `opencode run --format json`:

- `step_start`
- `tool_use` with:
  - `part.callID`
  - `part.tool`
  - `part.state.status`
  - `part.state.input`
  - `part.state.output`
- `text`
- `step_finish`

Current mapping:

- `tool_use` -> `TOOL_CALL_START` + `TOOL_CALL_ARGS` + `TOOL_CALL_END` + `TOOL_CALL_RESULT` when tool state is already completed
- `text` -> `TEXT_MESSAGE_*`

### `gemini-cli`

Observed from direct invocation with `gemini --output-format stream-json --yolo`:

- `init`
- `message` with assistant text deltas
- `tool_use` with `tool_name`, `tool_id`, `parameters`
- `tool_result` with `tool_id`, `status`, `output`
- final `result`

Current mapping:

- assistant `message` -> `TEXT_MESSAGE_*`
- `tool_use` -> `TOOL_CALL_START` + `TOOL_CALL_ARGS`
- `tool_result` -> `TOOL_CALL_END` + `TOOL_CALL_RESULT`
