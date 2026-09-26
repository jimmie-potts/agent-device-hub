## Context

The LIFX controller's lighting snapshot follows the `lifx-light` 1.0.0 profile, whose `lighting.pending` entries may only be `lifx.color.set` or `lifx.temperature.set`. #20 added an internal status paint and listed it there with a private kind, which the hub's strict validator rejects.

## Goals / Non-Goals

**Goals:** keep every lighting snapshot valid 1.0.0; keep the paint's queue, identity, cancellation and receipt behavior.

**Non-Goals:** a profile bump, hub or dashboard changes, showing paint progress in B.U.N.N.Y.

## Decisions

- Omit status paints from `lighting.pending` (owner, 2026-09-26). The receipt still becomes `lastOutcome`, and a sent paint `lastSuccessfulSend`, so evidence of each paint remains.
- Rejected: `lifx-light` 1.1.0 with a documented status-paint pending entry, which needs schema, hub validator and dashboard changes for a sub-second state.

## Risks / Trade-offs

For up to about a second a queued paint is invisible in the pending lists, while `maxInFlight` still counts it. A caller whose command is rejected for capacity at that moment sees no pending entry to explain it; with a queue bound of 8 and one paint per transition this is unlikely.
