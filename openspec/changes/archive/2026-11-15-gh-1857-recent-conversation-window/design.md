## Context

The companions module owns one conversation per profile. Its existing SQLite index orders messages by conversation and sequence. The dashboard's old reader starts at the oldest message and rereads all loaded pages on each refresh.

## Decisions

- Keep the authenticated module-content route. `profile` with optional `after` remains version 1. Opt in with `view=recent` and optional `before`. The response is `{version: 2, profile, conversationId, messages, currentTask, older}`. The newest read alone includes the current task and question; the question includes `id`, `text`, `answer`, `kind` and `proposal`, including its target, complete data and expected revision. It omits the internal call reference.
- Use a canonical base64url cursor containing the JSON tuple of profile, conversation ID and positive safe integer sequence. The cursor must match the selected profile and current conversation. A continuation reads strictly below that sequence. The cursor represents a sequence position; the anchor row does not need to exist. The cursor conveys position, not authorization.
- Select at most 17 records newest first through the existing index. Check the complete UTF-8 JSON response before including each candidate and return admitted rows oldest first. The extra row detects continuation at the 16-message limit. If a full first row with required metadata cannot fit, use the shared `capacity` refusal. Never drop or elide saved text to fit. Scope and cursor mistakes use `invalid-request`; storage failure uses `unavailable`.
- Decode before displaying a response, match the requested profile and conversation, and fence work that no longer belongs to the current view. An earlier-page response can prepend messages but cannot replace current question state. Refresh reads the newest window once. Overlapping windows merge by sequence; separate windows retain their own cursors and expose gaps. An explicit earlier read fills at most one window. The browser decoder and reader are available to the next Conversation layout; this change leaves the existing panel on its version 1 reader.
- The existing read permit is the authorization boundary. Reads make no writes, commands, speech, or lifecycle observations; content stays private and does not enter diagnostics. Explicit retry repeats only the read.

## Migration plan

No migrations or new owner. Version 1 clients can use the same route before and after source integration. The dashboard ships with the matching module; installed acceptance is separate.
