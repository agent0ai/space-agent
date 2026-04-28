# AGENTS

## Purpose

`server/lib/codex_cli/` owns the server-side Codex CLI transport used by browser agent surfaces.

This helper is intentionally backend-owned because browser JavaScript cannot safely spawn local processes, enforce workspace allowlists, or control Codex sandbox arguments. Keep this folder narrow: it may run a fixed `codex exec` command, but it must not become a general shell execution layer.

## Ownership

This folder owns:

- `service.js`: Codex binary resolution, workspace and sandbox validation, subprocess lifecycle, JSONL parsing, and OpenAI-compatible SSE stream creation.
- `prompt_format.js`: conversion of prepared Space Agent chat messages into one prompt string for `codex exec`.

The only endpoint that should call this helper is `server/api/codex_chat.js`.

## Contracts

- Use `child_process.spawn` with an argument array. Never build a shell command string.
- Send prompt text on stdin by passing `-` to `codex exec`; do not pass large prompts as argv text.
- Default `CODEX_HOME` to `/Users/nutic/.codex` unless a future explicit runtime parameter replaces it.
- Default sandbox is `read-only`; `workspace-write` is allowed only as an explicit request; `danger-full-access` is rejected.
- Allowed workspaces are the current Space Agent checkout and `/Users/nutic/Hermes/space-agent`.
- Treat Codex JSONL as completion-stream compatible, not token-streaming. Emit text when `item.completed.item.type === "agent_message"`.
- Keep stderr bounded and diagnostic-only. Successful Codex runs may still write warnings to stderr.
- Redact obvious bearer/API key shapes from errors before returning them.

## Development Guidance

Add model-facing prompt changes to `prompt_format.js`; add process, stream, or validation changes to `service.js`. Keep endpoint request parsing in `server/api/codex_chat.js` thin.
