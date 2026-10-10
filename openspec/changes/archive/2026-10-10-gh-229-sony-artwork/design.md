## Context

See proposal.md for motivation and the delta specifications for observable behavior. The playback module owns ordered Sony/Sonos presentation, stable record identity, metadata freshness and command admission. All consumers already use registered families and SDK sync. The image change is cross-cutting and handles untrusted bytes, so a design artifact is required.

## Goals / Non-Goals

**Goals:** acquire once, share a bounded image, preserve existing playback evidence and prevent obsolete completions.

**Non-Goals:** display layout, browser rendering, Sonos acquisition, image history, receiver discovery or installation through a legacy procedure.

## Decisions

Use optional top-level `artwork` with `{status: 'missing' | 'unsupported', generation}` or `{status: 'ready', generation, mediaType: 'image/png', width, height, base64}`. Register 2.1 alongside 2.0 rather than widen a closed released schema. The generation is a random UUID, not a hash of private metadata. Canonical base64 and PNG signature/IHDR dimensions receive bounded synchronous semantic validation; only the producer worker fully decodes image contents.

Keep candidate URL private in the internal observation. Compare its parsed origin with the configured Sony endpoint, reject credentials/fragments and all redirects, and stream at most 1 MiB. Query strings are permitted privately because they can identify a receiver image. A separate fetch facility leaves speaker control protocols unchanged. A worker using the already adopted sharp version accepts JPEG/PNG, limits decoded pixels, strips metadata and returns the bounded PNG.

Drive one current-artwork controller from the presented source and normalized title/artist/album. A separate candidate sequence rejects candidate replacement races. Keep one in-flight chain until settlement and coalesce replacements; do not create historical per-track maps. Retry transient acquisition failure after 2 s and 4 s, at most three attempts. Hard origin, format or capacity rejection does not retry. A completed image invokes publication evaluation without reporting metadata or reachability. Include artwork in the content comparison while keeping `observedAtMs` from metadata evidence.

Inline bytes fit comfortably below the envelope limit and avoid an asset service, filesystem handoff or new browser endpoint. Existing text consumers need compatibility verification rather than rendering changes here.

## Risks / Trade-offs

- Receiver metadata can lag while paused, and byte-identical metadata/candidate cannot prove a new track → associate only observable changes and document the receiver limitation.
- Native decoder memory is outside the V8 heap; SDK termination is not awaited → bound admitted work, input and decoded pixels; do not claim a native heap cap or physical thread nonoverlap.
- Artwork includes listening content → use synthetic public fixtures, retain real data privately and emit only fixed safe failures.

## Migration Plan

Build and validate the new producer with unchanged 2.0 validation and existing consumers before merge. Use the qualified current-runtime upgrade procedure when available; #1037 remains externally owned. Source acceptance does not waive installed identity/health or authorized visible-device evidence. Runtime restart starts with no retained image; the documented runtime recovery procedure owns rollback.
