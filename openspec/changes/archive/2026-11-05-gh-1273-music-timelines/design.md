## Context

See proposal.md for motivation. The Nanoleaf module already freezes static recipes and renders Lines and NL22 through one bounded encoder. Capture authority does not grant music device admission. A design is included because seek, missed-cue and cancellation semantics benefit from decisions before implementation.

## Goals / Non-Goals

The helper owns only an immutable plan and an in-memory cursor. It has no clock reader, scheduler, transport, SDK subscription, persistence or public package export. It does not construct measured audio or select device policy.

## Decisions

### Bounded semantic plans

Version 1 accepts 1 to 256 ordered, non-overlapping cues in at most 30 minutes. Each cue has a neutral bounded ID, integer offset and duration, a recipe and intensity from zero to one. Durations are at least 100 ms, so a non-overlapping plan contains at most ten starts in any half-open one-second interval. These limits bound parsing, scans and memory, not a physical cadence or flash guard. Gaps are explicit absence of a cue, with no blackout or restoration instruction.

Resolve supported presets through the existing `freeze` function and copy/freeze every recipe and palette. A caller must resolve favorites through their existing owner before preparation; the plan accepts no favorite-name reference. The version freezes recipe defaults, and a JSON round trip retains explicit values. No favorites migration is needed.

### Position selection and cursor generations

Use half-open cue intervals. The cursor takes an explicit local monotonic instant and starting position. Each sample selects only the current cue, with its elapsed time. Cues that begin and finish between samples are reported as missed; they are never emitted as catch-up work. Late start reports earlier completed cues. Intentional seeking selects directly and does not call skipped cues missed.

Start, pause, resume, seek and stop advance the cursor generation. Calls with an old generation return no result and mutate nothing. Pause freezes the position; resume starts a fresh clock anchor at that position. Seek preserves playing/paused state and invalidates old callbacks. Stop and backward local-clock movement permanently retire the cursor; a fresh instance is needed for another run. A generation is an internal callback fence, never device authority. A new instance starts unloaded for playback and never resumes prior execution.

### Reuse rendering without claiming synchronization

A pure helper scales the frozen palette by intensity and calls the existing renderer against explicitly supplied saved layout. It validates the layout again each time. Cue elapsed time describes semantic position only: the encoder still returns its ordinary animation from its beginning. No phase-accurate seek or physical pause is claimed. A future writer must evaluate #40, revalidate its live configuration and generations around awaits, enforce qualified per-device cadence and report its own outcomes. Queueing ordinary animation commands for every cue is excluded because it would retain obsolete work.

## Risks / Trade-offs

- A gap or stopped cursor sends nothing. A device may retain its last display until the future owner applies its accepted presentation policy.
- Complete recipes are larger than parameter patches. At 256 bounded cues the copy is finite, and seeking needs no replay of patches.
- Software time is not speaker time. #571/#41/#723 own qualified clock mapping and calibration.
- This helper has no persistence or external boundary. Invalid internal inputs throw fixed-text errors, and existing rendering refusals retain their codes; later SDK integration must map at its owning boundary under ADR 0012.

## Migration Plan

No stored format or runtime installation changes. The new helper has no production caller. Synthetic evidence contains no collected personal data under ADR 0011. The full #1273 remains open for its separately owned integration and physical acceptance.
