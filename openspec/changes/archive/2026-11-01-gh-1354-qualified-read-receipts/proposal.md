## Why

[#1354](https://github.com/jimmie-potts/agent-device-hub/issues/1354) adopts the opt-in read-receipt contract from #1341. A real Claude terminal button can identify the result the user selected, but the runtime has no consumer that binds that action to its finished notice.

## What Changes

- Add a Claude terminal extension and bounded helper that preserve the existing `claude/code` identity and correlate the native extension turn with the lifecycle `prompt_id`.
- Use existing SDK sync to bind the displayed result to its owner generation, notice and session revision. A click publishes lifecycle/2.1 metadata with that frozen target.
- Admit only the dedicated authenticated, qualified Claude producer. Codex Desktop remains disabled until a permitted actual-client qualification succeeds.
- Commit eligible read evidence and its session/2.1 output through the core's existing transaction, history and outbox. Keep the retained agent-state storage and legacy schemas unchanged.
- Verify the real UI, transactional failure cases, direct consumers and installed path separately.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `bunny-message-profile`: Versioned session read-receipt provenance while retaining lifecycle/2.0, session/2.0 and 1.x compatibility.
- `bunny-runtime`: Qualified receipt intake, exact target/revision checks and durable atomic session publication.
- `runtime-agent-hooks`: Explicit Claude terminal action, native ID correlation, private producer configuration and bounded helper.

## Impact

Changes affect event contracts, runtime core/gateway, the new Claude extension/helper and their tests and documentation. Shared session consumers gain validation for session/2.1. The existing SDK sync and publish transports carry the messages. There is no new state owner, polling path, device command, provider identity alias or transcript collection. Source delivery does not qualify Claude Desktop or Codex Desktop. The installed Mac runtime remains under its existing writer and upgrade procedure.
