## Why

The B.U.N.N.Y. guide, architecture viewers, atlas, reference, dashboard and wall map are separate destinations without a consistent route between them. [Hub #278](https://github.com/jimmie-potts/agent-device-hub/issues/278) asks for one recognizable set of places that makes each destination reachable in one click.

## What Changes

- Define the six place labels, order, grouping and destinations in one committed manifest.
- Render the same places navigation in the guide, nine architecture viewers, atlas, reference and dashboard; include it in the public export without requiring a local service or credential.
- Preserve existing local document links in source outputs and use public URLs in the published edition. Mark the two loopback destinations Local.
- Give the Nanoleaf wall map's return link its own owner in [codex-nanoleaf #189](https://github.com/jimmie-potts/codex-nanoleaf/issues/189); this change does not implement it.

## Capabilities

### New Capabilities

- `shared-places-navigation`: Common destinations, labels and one-click routes across Hub-owned documentation and dashboard surfaces.

### Modified Capabilities

None. The dashboard's existing authentication, controller and command behavior does not change.

## Impact

`docs/skins/`, guide and architecture generation, atlas and reference generation, public export, and `apps/dashboard/` change. The Hub keeps its existing three static assets and CSP; the browser receives only static destinations. The Nanoleaf wall map remains in its owning repository. Source delivery, public publication and installed browser acceptance are separate stages.
