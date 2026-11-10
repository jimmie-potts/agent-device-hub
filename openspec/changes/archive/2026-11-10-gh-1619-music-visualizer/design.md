## Context

The Audio page already projects the core's `music-capture-state` copy and the producer's `music-capture-features` occurrences in the browser (`CaptureProjection`), checking the source, generation, sequence, window timing and a clock qualified by the sync round trip. The visualizer is a second reader of that projection on Audio, a full view and Home.

## Goals / Non-Goals

**Goals:** draw two effects from qualified measurements at the display's frame rate; rest with a reason otherwise; keep the effect choice per browser; leave room for later effects.

**Non-Goals:** lighting, capture control, a shared saved setting, accessibility variants (owner decision 2026-11-10), installed TV acceptance.

## Decisions

- **Ownership and inputs.** The browser owns rendering only. It reads the existing projection; the core and producer stay the owners of capture state and features. No message format or route is added (ADR 0012).
- **One scope per page.** A sync whose round trip exceeds the capture clock bound leaves measurements unqualified. Two concurrent syncs for the same records on one page made that more likely under load, so every surface acquires one reference-counted scope per page connection. The last release closes the scope only after the page settles, so in-page navigation hands the synced scope to the next surface without a new sync. A scope the connection has already closed is replaced, and a later surface resyncs an unsynced view unless a sync is in flight.
- **Timing.** The engine eases from the shown value to the newest window over one 100 ms window interval and then holds it. Skipped windows are not replayed. A new source identity, generation or rest starts fresh.
- **Effects.** An effect is one entry in `visualizerEffects` that creates its own state and returns drawing primitives. A later effect is appended there with no change to the engine or the first two.
- **Preference.** The effect choice is a local-storage value read and written in try/catch; without storage it lasts for the page.

## Risks / Trade-offs

- Under a loaded browser the single page sync can still miss the clock bound, as before this change (#1580). The visualizer then rests with "Measurement timing is unavailable" rather than drawing unqualified data.
- Frame timings at 3,840 × 2,160 come from headless, software-rendered Chromium in a capped container and do not qualify AC6 either way; whether the full-screen view drops frames is judged at the owner's installed TV check.

## Migration Plan

None. The change is browser-only. Reverting it removes the surfaces; a saved Home layout naming `music-visualizer` then follows the existing omission of unknown definitions.
