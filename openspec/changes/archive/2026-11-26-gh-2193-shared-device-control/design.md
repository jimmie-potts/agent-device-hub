## Context

MCP and Companions authenticate independently and already reach the same tracked dispatcher. Device owners publish the `device` family through the SDK.

## Decisions

Both readers use a bounded SDK snapshot and the same device selection and facts. Conversation applies field-level sharing and tool permissions before exposing the result. MCP applies its existing scopes and uses the current credential at the read boundary.

Check new device requests inside the tracker admission transaction, after checking for a prior request ID. This keeps replays on the existing identity path. The tracker verifies the registered target and current owner record and leaves final execution admission and effects with the device writer. The core's existing guarded request records still bind an approved proposal to the selected device.

## Risks

An owner can restart between a read and dispatch. Missing synced evidence refuses a new guarded action. The writer keeps its own guards for changes after tracker admission. A partial read names each unreadable owner so it cannot be mistaken for an empty inventory.
