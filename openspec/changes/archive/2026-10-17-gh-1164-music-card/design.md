## Context

See proposal.md and issue #1164. The shell already owns PlaybackCard, useAttempt, playback copies and authenticated generation/revision artwork references. Rooms are currently lighting-layout definitions and a lighting-only composition. The approved design is presentation reuse; it does not qualify a new speaker or expand playback/2.1.

The schema requires design because this change adds durable metadata and crosses browser/core/contract boundaries.

## Goals / Non-Goals

**Goals:** one shared visual component, one existing connection and playback writer, persistent explicit placement of logical music cards in existing rooms, truthful freshness and supported controls.

**Non-Goals:** full Quiet rail shell migration, source/output selection, grouping physical speakers, new playback capabilities, a new home grid editor, image acquisition or physical playback acceptance.

## Decisions

1. Extract MusicCard presentation under the existing shared dashboard ownership. PlaybackCard retains useAttempt and passes an explicit action callback and current blocking reasons. Keep keyed image callbacks and playbackArtworkUrl unchanged. A module-specific frontend entry would add another adapter and registry without changing the existing common-card owner.
2. Add playback-layout/2.0 with entity ID playback, revision and bounded assignments of logical playback IDs to room IDs, plus playback-layout-set/2.0 with requestId, expectedRevision and the replacement assignments. Closed schemas and semantic validation reject duplicate identities and memberships. One core part owns the private table and follows LightingLayoutPart's authenticated operator admission and atomic state/outcome transaction. Reusing light assignments would make music IDs participate in light groups and block lighting controls; browser storage would fail cross-browser/restart persistence.
3. Existing lighting-layout room IDs/names remain authoritative. The Audio page offers explicit room placement. The Rooms consumer joins only current room identities with saved playback IDs and current unique playback records; it labels the composition as shared playback placement. Removed rooms never render a card, even if an older placement retains their IDs. Placement is recoverable through explicit editing and cannot route audio. No silent auto-assignment is inferred from configured ID or source rank.
4. Add one Audio route/navigation entry for all playback cards and preserve current Music record deep links. Home keeps its existing card placement. A small playback workspace composes the same adapter for all three surfaces and handles placement once through shared core copies, rather than introducing separate stores/connections per card.
5. Read-only, disconnected/failed copies, nonunique identity, missing operation evidence, unavailable owner or unresolved command block writes. Stale playback retains supplied last-known text; unavailable records clear it. Unsupported resume remains disabled with the iPhone hint. Output remains Not reported. Layout metadata updates never unlock a playback command.

## Risks / Trade-offs

- Shared playback can represent a different speaker after source ranking changes → label room assignment as card placement and keep output unknown; actual output identity remains #437.
- Concurrent placement saves or lost replies → expectedRevision, core atomic commit and tracked uncertainty; explicit refresh precedes another edit and nothing resends automatically.
- Old image callbacks, route changes and disconnected copies → retain the accepted artwork helper/key boundaries and its existing race tests.
- Missing or removed rooms and playback records → join against current synced membership; show stale configuration read-only and no invented device target.
- New private core table and state family → additive bounded storage, real restart tests, SDK sync tests and qualified upgrade inventory/readback. Core diagnostics retain registered codes and static text only; no listening content or room names enter publication.

## Migration Plan

The new core table starts empty, preserving existing room/light data and playback behavior. Build and validate the source, synchronize/archive specs, obtain independent reviews and exact-revision CI, then use the existing qualified runtime upgrade procedure under its operation lock. Passive installed checks verify the shared card and served identity; no device command is selected. Documented release recovery restores the preserved private baseline if needed. Existing legacy applications remain retained and untouched.
