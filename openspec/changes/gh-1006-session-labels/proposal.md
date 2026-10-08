## Why

[Hub #1006](https://github.com/jimmie-potts/agent-device-hub/issues/1006) preserves session labeling when the installed Hub moves to the runtime at #840. The runtime dashboard already displays explicit labels, but its core has no tracked label command and its session rows have no label control.

## What Changes

- Add the profile 2.0 `session-label-set` family: a qualified session target, request identity, label or clear, and expected session-record revision.
- Admit this operator action through the authenticated gateway's existing `control` authority, over HTTP and MCP. Ordinary core/module dispatch and SDK grants cannot admit it.
- Set or clear the user label through agent-state's existing owner. Commit the session, tracker completion, history and outcome in the same existing transaction, preserving refusal, deduplication and recovery behavior.
- Add row controls that distinguish requested, accepted and confirmed session state; retain drafts on a conflict and never resend after reconnect or reload.
- Integrate the existing operation family through unchanged tracked hooks; verify live projection/snapshot agreement and atomic completion for label, no-op, rollback and late result paths.
- Use focused contract/core/direct-consumer checks and one catalog label/clear scenario with its row/reload browser and accessibility journey. Preserve prior failure evidence and full hosted CI; no migration, framework or exhaustive local campaign is required (owner-approved scope, 2026-10-08).

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `bunny-message-profile`: add the closed, validated session-label command payload and its existing outcome envelope.
- `bunny-runtime`: add authenticated operator admission and atomic tracked label completion, including revision and recovery guarantees.
- `runtime-dashboard`: add session-row label/clear controls with separate command and synced-record evidence.

## Impact

Affected owners are `packages/event-contracts`, the runtime core/store/tracker, gateway and runtime composition, and `apps/runtime/dashboard`. The existing agent-state label rules, SDK wire contract, `CorePart.tracked` and `CoreTransaction` signatures remain in use. There is no new public scope, dependency, service or participant. Existing direct operator commands retain their route; labels remain tracked actions.

The source change is installed separately at [#840](https://github.com/jimmie-potts/agent-device-hub/issues/840). Agent self-labeling [#372](https://github.com/jimmie-potts/agent-device-hub/issues/372) and all-device notice clearing [#1009](https://github.com/jimmie-potts/agent-device-hub/issues/1009) remain separately owned. Metadata completion does not establish a device observation. No cross-repository contract changes are needed.
