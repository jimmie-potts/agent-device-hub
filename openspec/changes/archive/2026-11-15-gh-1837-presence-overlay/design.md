## Context

Presence Pro publishes complete `presence-observation/2.0` sensor records through
the SDK. The apartment already has stable room IDs, XZ meter coordinates, room
meshes, camera projection and fixture markers. ADRs 0011, 0012 and 0016 apply.

## Decisions

- Add the fixed presence family/owner to RuntimeFeeds and reuse its current-state sync and reconnect handling. No second participant or polling.
- Aggregate only explicitly mapped sensor/zone reports: any occupied wins, all vacant permits vacant, otherwise unknown. Preserve separate contributor status and disagreement. Coordinates never create occupancy.
- Consume producer-projected apartment meters; never compare mapping/calibration numbers with model revisions. Placement validity is manually checked in private producer configuration. Missing calibration remains no point. Artwork changes do not invalidate placement.
- Present anonymous source slots separately. A point on multiple room footprints is ambiguous and does not choose a room by array order. A floor marker expresses no measured height, identity or precision. Do not animate between reports.
- Show last scalar receipt times, held/unknown-hold and cached-report limitations. Connected silence has no TTL. A stale SDK copy clears usable highlights and markers; its retained text is explicitly last-known. Producer disconnect/restart already clears usable observations.
- Keep normal room/fixture inspection and a text alternative when WebGL fails. Renderer state is ephemeral; it owns no acquisition or private durable state.

## Failure, privacy and delivery

Reuse SDK authentication, registry errors, revision deduplication, bounded sync
retries and trace continuity. The view adds no command or outcome path, diagnostics
payload or new data sharing. Only synthetic fixtures/evidence enter source or
GitHub. A missing module, stale copy, source loss or unusable point must never imply
vacancy, departure or success. Lost observations/history are accepted. No migration,
backup, replay or recovery machinery is needed. Source/browser acceptance does not
qualify installed sensors; #1842 owns that pilot.
