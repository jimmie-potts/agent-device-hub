## Why

[Hub #1341](https://github.com/jimmie-potts/agent-device-hub/issues/1341) implements the owner's approved contract follow-up to [#1324](https://github.com/jimmie-potts/agent-device-hub/issues/1324). Explicit client read receipts need to identify the existing session and finished turn without relabeling shared Mac Codex or Claude Code sessions as Codex Desktop.

## What Changes

- Add opt-in lifecycle/2.1 support for an explicit read-receipt occurrence, alongside every existing lifecycle/2.0 observation.
- Bind a receipt to the full session identity, known turn, owner generation and finished notice. Distinguish an accepted provider-client read action from a view action in an application-owned UI.
- Supply pure reference admission decisions for qualified sources and the current session. Unknown, mismatched or obsolete targets remain ineligible.
- Preserve default registration and existing runtime behavior. This contract does not install a collector, mutate provider read state or adopt a new runtime reducer.
- Document the Codex experiments, Claude's separate qualification requirement, metadata collection boundary and remaining UI evidence.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `bunny-message-profile`: Add an explicitly selected lifecycle minor version and reference decisions for qualified read receipts; retain the existing profile, schemas and default registration.

## Impact

The event-contracts package gains a separate opt-in entry point, schema, synthetic fixtures and tests. Its package export and owning contract/development guides change. No runtime, hook, device, external repository, credential or storage format changes. Default SDK/runtime validators continue to reject lifecycle/2.1 until a later consumer explicitly adopts it. Current session/2.0 output and retained 1.x contracts remain unchanged.
