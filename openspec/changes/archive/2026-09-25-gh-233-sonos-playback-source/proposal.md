## Why

[Hub #233](https://github.com/jimmie-potts/agent-device-hub/issues/233) adds the owner's Sonos Move as the second playback source. The owner's iPhone plays Apple Music over AirPlay to the Move, alone or grouped with the Sony HT-A9, and today the hub sees nothing while the Move plays. The [play and resume check](../../../docs/iphone-apple-music-qualification.md#play-and-resume-check) of 2026-09-25 showed that the Move can pause and resume the AirPlay session, for itself and for a grouped HT-A9, while the HT-A9 cannot resume. On 2026-09-25 the owner chose an ordered source preference over the explicit `selected` source that [#175](https://github.com/jimmie-potts/agent-device-hub/issues/175) designed: the phone chooses the output, so the hub follows it.

## What Changes

- Add a Sonos source module that reads the Move's local UPnP AVTransport service and normalizes its transport state, AirPlay session, metadata and advertised actions into the shared observation. It declares pause, next and previous while playing and play, next and previous while paused.
- Turn the shared playback module into a multi-source module. Configuration becomes `{"id", "sources"}` with the sources in preference order, at most one Sony and one Sonos entry. Every source is polled and keeps its own freshness. The presented source is ranked by reporting playing or paused, then freshness, then configured order. Snapshots and receipts carry the stable `id`; commands go only to the presented source.
- Reject the old `{"selected", "sources": [{"id", ...}]}` form at startup; the upgrade is a documented edit of the private configuration file.
- Retarget the closed duplicate #301 to #233 in the hub guide and the qualification record and replace the single-selection wording in the architecture guide.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `hub-playback`: several polled sources under one stable playback ID, the preference rule, the Sonos Move source and presented-source commands.

## Impact

Standalone hub source (`playback.ts`, new `sonos.ts`, `sony.ts`, `server.ts`, `common.ts`), the hub tests, the hub guide, `docs/development.md`, `docs/architecture.md`, the qualification record and the hub package version. No shared package, controller contract, dashboard, MCP or CI workflow change: the 1.0 snapshot shape is unchanged, so B.U.N.N.Y., the MCP tools and the Tidbyt and Pixoo cards keep working, and the existing hub jobs run the new tests. Position and duration stay out of the snapshot because both display parsers reject unknown keys (#38 and #39 revisit). Source delivery installs nothing and contacts no speaker; the live check on the issue needs the owner and the Move.
