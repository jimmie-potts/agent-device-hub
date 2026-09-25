## 1. Controller installations

- [x] 1.1 Write failing connection tests for pushes, removals and listings that name an additional installation, an unlisted installation rejected without a request, and invalid additional ID configuration. Then add `additionalInstallationIds` and the optional installation argument.
- [x] 1.2 Write failing controller tests for a named-installation push, an unknown installation rejected before reservation, a shared 429 hold across installations, per-installation refresh evidence and reconfigure clearing it. Then add the `installation` command field and raise the profile to 1.2.0.

## 2. Shared writer

- [x] 2.1 Extract the status publisher's cadence, backoff and presence logic into a shared installation writer and bounded reader, with every existing status publisher test still passing unchanged.

## 3. Now-playing view, card and publisher

- [x] 3.1 Write failing view tests for playing, paused, stale, failed-read, aged-out, unavailable, stopped, inactive and unknown snapshots. Then implement the view.
- [x] 3.2 Write failing card tests for markers, wrapping, truncation, missing title or artist, accent folding, the new punctuation, stale dimming and a golden card image decoded by Pillow. Then implement the card drawer and font additions.
- [x] 3.3 Write failing publisher tests with a fake feed, clock and connection for the 5 s poll, coalescing, the 15 s gate, the 10-minute refresh, removal with the listing check, failed and uncertain writes without replay, backoff and coexistence with the status publisher on one controller. Then implement the publisher.

## 4. Runner

- [x] 4.1 Write failing runner tests for the playback feed's envelope validation, source mismatch, bounds, redirects and failures, the optional `nowPlaying` configuration and its rejection cases, and a status-only configuration that stays unchanged. Then wire the feed and publisher into the runner.

## 5. Documentation and delivery

- [x] 5.1 Record the decisions, profile 1.2.0 and runner configuration in `controllers/tidbyt/README.md`, and update `docs/development.md` and `docs/architecture.md`. Verify by inspection.
- [x] 5.2 Run build, typecheck, contracts, Tidbyt (TypeScript and Python) and workflow checks. Then synchronize the spec deltas and archive this change.
