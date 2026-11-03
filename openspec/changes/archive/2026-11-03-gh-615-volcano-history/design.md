## Context

The container has no radio, so the Mac Mini's Bluetooth is reached by a host-local process, as the Codex Desktop collector reaches a Codex home. The trial established that manual heater, pump and setpoint changes notify, the counter counts whole minutes while heating and survives a disconnect and a collector kill, one tick arrived only through a poll, and `status2` bit 13 flips by itself. It left the counter's power-off behavior and hour rollover unverified.

## Goals / Non-Goals

**Goals:** one history owner; facts that survive restarts without duplication; no fabricated continuity; a transport that cannot write; authenticated bounded reads; a threshold that regroups without rewriting.

**Non-Goals:** the card (#616); installation, the macOS wrapper and physical acceptance (#617); device control; release-for-app or delete controls; consumption, dose or inhalation estimates.

## Decisions

**A pure reducer between snapshot and facts.** `admit` and `reduce` take the committed continuity and a snapshot and return the next continuity and its facts. A refused commit changes nothing, and a restart resumes from what was committed, so a repeated snapshot or a restart cannot add a fact twice.

**Snapshot order follows `RemoteFeed.take`.** A repeat of `(epoch, sequence)` is dropped first. A non-newer `observedAtMs` is dropped and renews nothing; once the feed is stale it moves the baseline to its own stamp, so a stepped clock or a future stamp holds the feed for one window and one cycle. The next snapshot taken across such a step records a `clock-step` discontinuity, because no interval is computable across it.

**Facts carry how exactly their time is known.** A heater fact's `edge` is `observed`, `first-observation` or `after-gap`. A `gap` fact, with the heater on each side and the counter's gain, is written when observation resumes, whether the link broke or the feed went silent for more than 15 s. A reconnect within a second still counts, because the interval was still unobserved. A stale feed adds one `link` marker and nothing about the heater.

**Sessions are derived over structural facts only.** Temperature, counter and markers stay out of the walk. A stretch with no observed end reports `lastObservedOnAtMs` and `endedUnobservedBy`, and its separation from the next stretch is measured from the first time it was seen off. A boundary is only ever placed at an observed edge, so a gap never creates one inside itself. A gap with the heater off at one edge and on at the other leaves the observed edges as the boundaries. Those separations are marked `uncertain` in the distribution.

**Counter rule.** `hours*60+minutes` is the cumulative value. A decrease is `counter-decrease`, and a gain larger than the elapsed minutes plus one is `counter-jump`. Each stops a credit crossing it. Rollover being unverified, a transient decrease at an hour boundary would record a discontinuity, which loses at most that one credit.

**Availability is read at the moment.** A published state holds what its commit knew, and a timer publishes staleness at 15 s. A read computes freshness from this process's last taken snapshot, so a store from an earlier run proves nothing until the next snapshot.

**Publication stays in the transaction.** Facts, continuity and state messages commit together through the outbox, which handles a restart between commit and publication. The one exception: while the store refuses every commit, staleness is announced unstored, because a full disk must not leave consumers reading available. The module keeps retrying the marker.

**A refused commit fences nothing.** Unlike a device writer, no effect is at stake, so the next snapshot simply tries again, and `recording` says `refused` meanwhile.

**The threshold's range is the module's rule.** The family's schema says integer, so an out-of-range value is an accepted command with a `failed` outcome and `invalid-request`, as #615 requires; a malformed one is refused at the edge. `succeeded` carries `observed` evidence, because ADR 0012 requires evidence on success and the module observed its own commit. Storing the value and its outcome in one transaction means no started state exists to recover.

**The module's synthetic feed bypasses the bus.** Harnesses have no collector credential, so `SimulatedVolcano` hands snapshots to the same `#take` path. Real builds have no such feed, and the option is not reachable from a manifest, gateway or configuration.

**No write in the type.** `VolcanoTransport` has scan, connect, read, subscribe and disconnect, and the adapter's noble types omit every write. The adapter also asks noble only for the allowlisted services and characteristics and refuses other UUIDs.

**The binding is outside the root.** `apps/volcano-collector` is not a workspace and pins noble in its own lockfile. The root build compiles its adapter against local types and a computed import name, and its tests use a fake. `bin/volcano-collector.mjs` loads it only after both private files pass.

## Risks / Trade-offs

- Deriving sessions reads every structural fact on each read. At a few uses a day this stays small for years; a page cap bounds the answer, not the walk. Revisit with a read-time cache if the fact count grows.
- The collector publishes `now()` as `observedAtMs`, so coalescing can stamp a transition up to a second late. That is within the trial's granularity and stays honest about what was published when.
- A stopped collector's last link fact can be `connected` with a stale marker after it. A reader of the timeline sees both, in order.

## Migration Plan

Additive. A new module database appears only when the section is configured under #617. Rolling back to a release without the module leaves the file for the upgrade inventory, which refuses an unknown owner, so recovery to such a release needs the file set aside; there is no installed Volcano before #617.

## Open Questions

None for this source. #617 owns auto-off with an observer connected, the launch wrapper and firmware behavior.
