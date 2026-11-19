## Context

The playback module owns the current presentation and publishes the interval-bounded Music observation under `playback-position/2.0`. The native producer brackets the position read with item reads. A matching bracket identifies the local item scope and process, and the position record explicitly leaves exact audio-version association unqualified. The existing Nanoleaf worker pins an immutable saved show and advances a version-one timeline on a local monotonic clock.

## Goals / Non-Goals

**Goals:** Bind an immutable version to a scoped Music library item, admit one explicit measured start, and fence its cues on changes in playback evidence.

**Non-Goals:** Exact audio-version verification, speaker-clock calibration, changes to receiver commands, and installation or physical capture during source delivery.

## Decisions

- Keep playback observation and any association qualification with its owning producer and playback module. Reuse the SDK state sync and live delivery path. A read or reconnect supplies state and creates no Start.
- Validate measured versions and current alignment beside the existing Nanoleaf show admission and device queue. The core remains the operator command owner. The device worker checks the current evidence before it takes external control and before it sends frames.
- Distinguish private scoped Music library item and analysis provenance from disposable alignment evidence. A playback observation's interval, source, process and discontinuity determine whether its position can advance the show. A new seek anchor invalidates earlier queued cues before any evaluation of the previous position. Retain the most recent seek revision across subsequent observations. A playback sync gap suspends the evidence immediately and retires any active show before the replacement snapshot can authorize a new explicit start. A source change ends the show and uses the existing restoration policy.
- Accept capture windows only for the core's current active Music capture binding. Buffer at most 50 windows. A later compatible observation confirms the item and measured transport progress before accepting the preceding windows. Leave a capture clock uncertainty margin at both ends. Drop the buffer on loss, a discontinuity, or a change of item, process, or declared output. Use the original bounded read interval to project each confirmed window's end.
- Verify measured saves using a per-run proof of the bound item and analysis metadata. The save stores the metadata but drops the proof. Later edits can reuse the immutable prior version's metadata.
- Keep item evidence and authored content in declared private fields. Use existing shared refusals and diagnostic codes without recording names, paths, identities, or analysis payloads.

## Migration Plan

Create a separate catalog marker table for measured versions. Preserve the
existing show version table and its decorative rows so earlier code can still
add and read decorative versions. The older runtime refuses measured version
bodies. A restart discards only in-memory preparation and playback work.

## Risks / Trade-offs

- Title, artist, and duration alone do not identify the selected library item. The first release matches the library scope and item identifier. Replacing the audio under an unchanged item can escape detection.
- Position and output observations can lag or be unavailable. Derive cue position only within the accepted freshness and uncertainty bounds. The declared Music output does not establish audible speaker time.
- Decorative versions predate scoped Music library item and analysis provenance. Continue reading those values as decorative and preserve their start and editing behavior.
