## Context

See proposal.md for motivation and Hub #1162 for acceptance. Both renderers already accept playback/2.1 thumbnails. The producer, passive content guard and diagnostic attribution currently assume Sony. Read-only qualification found a same-origin Sonos /getaa image that passed the existing decoder limits. Include this design because URL admission and source/track concurrency affect several consumers.

## Goals / Non-Goals

Keep one acquisition owner and one device writer per display. Support the existing Sonos AirPlay source without changing speaker preference, device modes, schemas, store formats or credentials. No internet lookup, image history, legacy feature port or additional Sonos input type.

## Decisions

1. Extract albumArtURI from the existing bounded DIDL-Lite metadata read, retaining only the bounded private candidate. Invalid artwork does not invalidate valid text. Do not add another receiver poll or consumer fetch.
2. Make artwork URL admission source-specific. Sonos accepts an absolute or relative HTTP reference resolving to its configured origin. Sony retains absolute URLs plus its accepted same-host 58080 exception. Carry the source through acquisition and revalidate it in the fetcher; do not broaden a shared host/port policy.
3. Reuse playback/2.1, the current single fetch/decode chain, existing deadlines, byte/pixel bounds, retries and worker isolation. Scope generations to source and reported track, preserving duplicate/pause/freshness behavior. Missing Sonos content becomes missing rather than unsupported; neither speaker borrows the other's image.
4. Generalize the passive-content eligibility guard to either supported source while preserving exact committed-record/current-image matching. Attribute each media diagnostic to its acquisition source and reset failure transitions on a source/track association change. Follow ADR 0012 and the diagnostic contract; acquisition never changes command outcome semantics.
5. Extend the existing explicit synthetic artwork action to either speaker. Exercise real parsing, decoding and both render workers through the shared speaker-artwork scenario. Preserve a no-art handoff before enabling the Sonos fixture to prove the previous source image clears.

## Risks / Trade-offs

- Receiver image timing can lag metadata: retain observation/candidate fences and report only receiver-observed association.
- Relative or malicious URLs could escape the speaker: normalize once against its configured origin and validate again before fetch; reject redirects, credentials and fragments.
- Late work can cross identical-text handoffs: retain generation/source fences and add both-direction regressions.
- Images can fail decoding: retain bounds, isolated workers, safe diagnostic codes and text fallback.

## Migration Plan

No data migration or configuration change. Deliver through the existing PR/review/CI gates, then qualify the exact merged release against the current installation's configured owners. Use apps/runtime/UPGRADE.md with locked planning, backup, atomic selection, verified running identity/state and durable receipt. Recover through the qualified previous release on latest durable state only after actual failure; never replay device commands. Keep actual-display observations separate from installed/source evidence. Installation and any outstanding physical acceptance remain in the issue, not source-task completion.
