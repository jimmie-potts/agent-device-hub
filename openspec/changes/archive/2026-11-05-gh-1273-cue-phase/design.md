## Context

See proposal.md for motivation. Canonical pattern functions produce RGB keyframes with a decisecond duration for the transition into each frame. The initial source color is absent. A design is included because this ambiguity and unequal durations need explicit decisions before coding.

## Goals / Non-Goals

The helper exposes canonical endpoints and timing only. It cannot authorize playback, read a saved layout, infer an initial controller color or interpolate a physical color. The caller supplies validated semantic cues and layout values. There is no production playback caller.

## Decisions

### Prepare canonical frames once

Extract the existing renderer's frame-building portion into `prepareAnimationFrames`, returning frozen zones and the unchanged display payload after existing capability/capacity checks. `render` delegates to it and returns the payload. `prepareMusicCueFrames` reuses the existing intensity-scaled command and layout projection and returns a frozen cue duration, loop flag and tracks. This avoids parsing encoded strings or duplicating pattern formulas. The existing package `effects` namespace additively exposes `prepareAnimationFrames`; existing names, signatures and values remain unchanged. No package export-map path, remote preparation contract or route is added. The coordinator confirmed #760/#1238 have no concurrent source owner; their public contract remains separate.

### Locate transitions without inventing color

`locateMusicCuePhase(prepared, elapsedMs)` takes cue-relative elapsed time and returns frozen per-zone descriptors. For an active transition it reports the target endpoint, frame index, cycle, elapsed and remaining transition milliseconds, and an origin discriminant: unknown for the first transition of the initial cycle, otherwise the previous canonical endpoint. Actual durations, including unequal pulse/breathe/sparkle durations, determine boundaries. Exact boundaries begin the next transition. Looping uses modulo track duration and the last frame as the next cycle's first origin. A completed one-shot reports its final endpoint. At cue duration or later it returns cue-ended with no presentation instruction. Invalid negative/nonfinite/unsafe positions throw the existing fixed-text position error.

A stateless locator makes late starts, pause and seek use current elapsed time directly. It performs no catch-up. Returning transition metadata preserves uncertainty; a new RGB interpolation formula or immediate first-frame anchor would change interpretation without evidence.

## Risks / Trade-offs

- Extracting a shared renderer could alter old output. Retain byte-digest tests and compare prepared payloads and legacy rendering for all supported patterns on Lines and Panels.
- Endpoint/timing descriptors do not establish controller interpolation or phase-seek support. Keep these claims out of the API and documentation.
- A prepared layout can become stale. Preparation validates supplied values; future playback must independently validate current state.
- Source bounds do not establish device cadence or flash policy. Worker admission and physical qualification remain outside this cut.

## Migration Plan

No stored/wire format, persistence, diagnostics, ownership or installation change. Frozen V1 saved cues and ordinary animation bytes keep their meaning. There is no new recovery behavior or personal-data collection. Existing ADR 0012 boundary/error rules remain for future integration; these synchronous internal helpers retain fixed-text exceptions and existing `Rejected` codes without records or retries.
