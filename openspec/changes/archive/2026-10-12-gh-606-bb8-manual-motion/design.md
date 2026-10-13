## Context

See proposal.md and [#606](https://github.com/jimmie-potts/agent-device-hub/issues/606). The accepted96 module tracks responsibility through the SDK; Windows has one FIFO executor and PacketV1 writer. The existing shared Command disables ordinary controls while an attempt is pending. Design is required for the cross-component timing/concurrency change.

## Goals / Non-Goals

Extend this same writer and tracked page with one finite step and a usable Stop. No additional process, durable motion state, transport framework, firmware options or indefinite armed mode.

## Decisions

- Public `bb8-aim` (set/clear), `bb8-step` and `bb8-stop` extend the closed2.0 contracts. Steps use cardinal directions, speed1–32 and duration100–500ms; UI20/300. Raw heading/bytes and continuous drive remain refused. Existing authenticated operator entry remains required; MCP/automation refusals remain.
- A helper-owned optional forwardReference token is ephemeral and bound to helper epoch/connection generation. Set forward uses stabilization OFF, heading0, stabilization ON after the operator manually positions the robot. Clear forward sends no radio packet. Reconnect, wake, loss, restart and uncertain motion clear it. Repositioning requires the explicit Clear/Set flow. No firmware watchdog or persistent setting is selected.
- The existing bounded queue becomes a small array. Stop is inserted first, interrupts the active step's response wait, and invalidates pending movement; only one step may be admitted. One pending/result slot is reserved for Stop while a step exists. Ordinary capacity is unchanged otherwise. Original admission/effect/result persistence stays intact.
- PacketV1 roll is DID2/CID48, five bytes (speed, two-byte heading, GO1/STOP0, reverse0), grounded in the [pinned MIT command implementation](https://github.com/artificial-intelligence-class/spherov2.py/blob/4252ddb1a12a25db725257d66e3e8ec3057dd48b/spherov2/commands/sphero.py). The reference reset sequence is in its [V1 controls](https://github.com/artificial-intelligence-class/spherov2.py/blob/4252ddb1a12a25db725257d66e3e8ec3057dd48b/spherov2/controls/v1.py). Reserve sequence space before starting a step. The timer begins at the first possible GO write. Deadline or explicit Stop interrupts only the GO wait, never its native connection signal; a distinct selected Stop packet follows, with a fresh sequence. The native worker already serializes write requests. A late GO reply cannot acknowledge Stop. Local completion checks still bind the selected writer/identity/link, but are independent of the original command expiry. The Stop has its own bounded response budget.
- A validated GO and selected Stop report transmitted success, never observed rest. Missing GO/Stop response or interruption can report uncertainty; a acknowledged local Stop may preserve a usable link for further explicit Stop, while clearing the reference. Radio/host failure can prevent Stop reaching the robot. Supervision and containment remain necessary.
- The page uses a separate instance of the existing tracked Command for Stop so an ordinary pending attempt cannot hide it. No shared SDK/frontend contract change is needed.
- Errors/outcomes/logs follow ADR0012 and the diagnostic contract. Wrong source/target, stale guards/reference, expiry, duplicate/capacity and loss use existing registered codes; no retry. Registered setup operation spans retain trace continuity; raw radio/device details stay private.

## Risks / Trade-offs

Lost BLE/native host → Stop cannot be guaranteed; refuse movement, show uncertainty and require nearby operator.

Native write callback/host scheduler delay → the local deadline requests Stop, but delivery/rest is not a hard real-time promise. Existing native serialization and bounded calls apply.

Manual orientation or repositioning → reference is an operator assertion, not a measured heading; clear and reset before further steps.

## Migration Plan

No database migration or new dependency. Existing records without a reference remain valid; no stored movement is replayed. Old-release reader compatibility is not inferred from an optional field. Deliver module/helper together after exact reviews/CI, preserving current configuration and state with the owner-reduced ordinary update. No backup/recovery rehearsal is added. Installed supervised observation is separate and requires exact motion permission, dock removal and nearby containment before movement.
