## Why

[Issue #1619](https://github.com/jimmie-potts/agent-device-hub/issues/1619), phase 1b of [#1617](https://github.com/jimmie-potts/agent-device-hub/issues/1617) under epic [#720](https://github.com/jimmie-potts/agent-device-hub/issues/720): the owner wants to see the measured Music audio on screen, on Audio, on Home and full screen on the Mac's TV, beside the lights the same measurement drives. Owner decisions, 2026-11-10: the first effects are spectrum bars and bass pulse; the effect choice is a per-viewer preference kept in the browser; the visualizer has no accessibility requirements.

## What Changes

- Audio gains a **Music visualizer** panel with an **Effect** choice of Spectrum bars or Bass pulse. Effects draw on a canvas every display frame from the derived capture features the Audio page already reads: the applied response values when present, otherwise the measured level and bass, mid and treble bands.
- The visualizer shows only qualified, fresh, generation-bound measurements. It eases toward the newest feature window and never replays skipped ones. Otherwise it rests: a still scene with the reason.
- **Fill window** opens `#/audio/visualizer`, a view that covers the page chrome and offers **Full screen** through the browser's Fullscreen API. **Exit full view** or Escape returns to Audio.
- A **Music visualizer** Home card in the Audio category of Add card shows the chosen effect, why it rests and **Open full view**. It is not on Home by default.
- Surfaces on one page share one read-only capture scope, so a page makes one capture sync. The measurement card uses the same scope.
- The effect choice is kept in this browser's local storage. It is not a shared setting.

ADR 0012: no new message format, error shape, family, command or gateway route, and no new path that polls the Hub. The visualizer reads the existing `music-capture-state` copy and `music-capture-features` occurrences through the shell participant.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `runtime-dashboard`: a read-only music visualizer on Audio, its full view and a Home card, and a browser-only effect choice.

`home-layout` is unchanged: its catalog requirement already covers a registered core card that is offered, added, moved and removed through the existing editor.

## Impact

- `apps/runtime/dashboard`: the visualizer model, effects, preference and components; the shared capture scope (`src/music-capture-scope.ts`) and its use in the measurement card; the widget catalog, Home catalog, route and Audio composition; unit tests, a browser journey imported by the Music-card browser entry, and the dashboard and runtime guides.
- No contract, schema, storage, migration, device, credential or runtime configuration change. Installation and the owner's installed view (AC5, and AC6's TV check) stay pending.
