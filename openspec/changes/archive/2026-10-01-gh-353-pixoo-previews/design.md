## Context

See proposal.md for purpose. The current Hub forwards closed JSON integration snapshots with one slot per controller. The browser already serializes per-device reads; PNG responses need that same path. Design is required because this change spans the producer boundary, authenticated binary reads and animation timing.

## Goals / Non-Goals

Goals: exact rendition previews without exposing controller credentials, reusable widgets, bounded work and legacy compatibility. Non-goals: uploads, playlist editing, device commands, physical qualification, new event infrastructure and layout persistence.

## Decisions

Negotiate snapshot 1.1 explicitly and retain 1.0 commands. Forward only typed route arguments and validated representations; no arbitrary URL proxy. Binary reads share the controller slot and browser scheduler. Decode PNGs to canvas with nearest-neighbor scaling, preserving CSP and bearer-in-memory authentication without object URLs. Bound admitted manifests to the producer contract maximum of 1000 frames (the default import allowance is 500) and fetch frames sequentially. Use the complete decoded animation for manifest-based playback, so missing frames produce an error instead of silently skipping. At most one selected animation per grid is active; visibility, selection, reduced motion and unmount cancel it. Per-widget decoded buffers are released on cleanup.

Use existing five-second integration polling for catalog revisions. A feed resync coalesces one controller refresh. Compare revisions across related catalog reads; immutable rendition IDs keep frame identity independent of unrelated catalog updates. Current-media state describes player selection/intent and transmission uncertainty, never optical output.

## Risks / Trade-offs

- One thousand RGBA 64x64 frames use approximately 16 MiB per active animation; sequential loading shows progress before playback.
- Shared device reads can return capacity when another browser or MCP caller holds the slot; surface the error and allow explicit reload, preserving no automatic retry.
- Source support does not qualify device playback; display compatibility separately.
- Upstream malformed representations fail closed; access checks still run before conditional 304 responses.

## Migration Plan

No persistent state changes. Source delivery upgrades the Hub consumer after the producer merges; 1.0 controllers retain controls and display a catalog-unavailable reason. Rollback restores the previous Hub source without changing the Pixoo library. Installation and current-candidate UI approval remain coordinator gates.
