## Why

[Hub #285](https://github.com/jimmie-potts/agent-device-hub/issues/285) adds artwork to the current Tidbyt and Pixoo cards. Playback owns the compatible `playback/2.1` thumbnail from #229; both displays currently ignore it, and their render and queue boundaries need to reject superseded observations.

## What Changes

- Decode the bounded optional PNG in each existing render worker and show it beside readable status, title and artist text. Preserve the exact text frame when artwork is missing, unsupported or invalid.
- Associate pending renders and queued writes with the playback observation, independently of textual track-change triggers. Coalesce changes and discard obsolete work before device admission.
- Preserve Tidbyt rotation, holds, end-based gate and refresh, and Pixoo attention, Media choices, pop-up deadline and player recovery.
- Add synthetic golden, race, queue and integrated runtime evidence, plus the physical-trial handoff to epic #1054.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `runtime-tidbyt`: optional artwork in the existing now-playing card; current-target checks after rendering and queued admission without consuming a gate or persisting a discarded write.
- `bunny-pixoo-module`: optional artwork in the private card renderer; observation-aware cache and queued cancellation while retaining existing presentation and effect semantics.

## Impact

Changes stay in `modules/tidbyt`, `modules/pixoo`, their owning guides and the existing runtime test/scenario paths. Playback simulation adds a fixture-only acquisition counter and fixed-marker remote reply so the integrated check measures actual byte acquisition. Tidbyt promotes its existing pinned `sharp` dependency from development to production, with one workspace lock entry updated by the coordinating writer. No new package, source fetch, gateway route, public Pixoo browser-view field, database-sharing path or legacy-service implementation is needed. The existing SDK and playback state contract remain unchanged. This story finishes at reviewed, merged source; #1054 owns installed integration and separately authorized physical observations.
