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
| `opencode-cli` | native live | pending | pending | yes | Text payloads emit assistant events; richer tool semantics not mapped yet. |
| `gemini-cli` | native live | pending | pending | yes | Result/text records emit assistant events; raw JSON preserved. |
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
2. Decide whether any native records should become `REASONING_*` events.
3. Extend native tool/reasoning mapping for `opencode-cli` and `gemini-cli` if their streams support it cleanly.
4. Decide whether SDK runners need richer semantics than final assistant text for v1.
