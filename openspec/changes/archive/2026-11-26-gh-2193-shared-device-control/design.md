## Context

MCP and Companions authenticate independently and already reach the same tracked dispatcher. Device owners publish the `device` family through the SDK.

## Decisions

Both readers use a bounded SDK snapshot and the same device selection and facts.
Per-light temperature ranges are supported by the additive `lifx-light/2.1`
record. The shipped owner retains its existing range. Pixoo's bounded catalog
preview delegates exact IDs to the complete owner catalog. Conversation applies field-level sharing and tool permissions before exposing the result. MCP applies its existing scopes and uses the current credential at the read boundary.

Check new device requests inside the tracker admission transaction, after checking for a prior request ID. This keeps replays on the existing identity path. The tracker verifies the registered target and current owner record and leaves final execution admission and effects with the device writer. The core's existing guarded request records still bind an approved proposal to the selected device.

## Risks

An owner can restart between a read and dispatch. Missing synced evidence refuses a new guarded action. The writer keeps its own guards for changes after tracker admission. A relative
command includes the reading's time, value and device guards. A target's pending
work or newer tracked effects invalidate that reading before a new operation can
commit. The tracker keeps the named owner's LIFX color copy live until admission,
so a color-only update during the transaction wait invalidates the earlier basis.
Owner-local library, layout and acknowledgment actions retain their offline
admission. The owner's manifest declares that exception per command family.
The core takes the declaration from the same qualified registration as the
selected target. Unlisted commands require an available device. Conversation
uses the tracker for availability. Holds and applicability remain separate checks. The exact basis is part of the request identity. A new relative action
needs a fresh reading after an inbox failure. A partial read names each unreadable owner so it cannot be mistaken for an empty inventory.
