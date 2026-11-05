## Context

`docs/art-generation-qualification.md` owns the route, the job and result shapes, the case table, the spending rules and the handoff. #679 owns the job and dispatch families and #1418 owns weather; both merged during this change. ADR 0012 gives each module its own SQLite file and outbox, and forbids automatic resends.

## Goals / Non-Goals

**Goals:** every case and trace in the record holds on fake providers; spend is inspectable per provider; favorites and the ledger survive a restart.

**Non-Goals:** device responders, dashboard widgets and scheduling (#681, #682, #684, #1288); defining #679's families; real provider calls; a general asset store.

## Decisions

**Separate limits per provider, one loop guard.** The owner's decision of 2026-11-03 names ceilings and paces per provider and one guard of about 30 images an hour. The guard exists to stop a runaway loop, which is one failure however its calls are spent, so idea and image calls share one count.

**The daily pace counts all of a provider's spend that day.** Owner requests therefore use up automatic room. The alternative, counting only automatic calls, would let automatic art spend its full pace on top of a heavy owner day, and the pace is meant to bound the day. Owner requests themselves are never limited by the pace.

**Limits are edited in the section.** A module has one configuration path (`ModuleSettings`), and a change takes effect at the next start. An edit command would need a family that #679's set does not name. The state shows the limits in force.

**`reserved` and `dispatched` are separate committed steps.** A dispatched mark commits before any send, so a restart knows which calls may have run: a `dispatched` call becomes `uncertain` and keeps its reservation, and a `reserved` one provably never left and is released.

**A variation sends no input image.** The record refuses any input image without an observed price entry, and none was observed. A variation is a new request built on the source's saved idea and names its source in `variationOf`.

**A failed idea call does not fail the art.** The call keeps its own row and terms. The prompt falls back to the owner's words or an imagined scene, and that fallback costs nothing. Image calls never fall back to another provider.

**Sharp reduces and `gifenc` quantizes.** `sharp` 0.35.4 did not honor `colours` in a probe: its GIF output held 256 colors from a request for 32. `gifenc`, already pinned for Pixoo, enforces one shared 32-color palette. Sharp still does the Lanczos reduction.

**Every display gets a GIF, and the browser its own still.** The owner chose GIF output on 2026-11-04. A job has no selector for motion, since `v2/art` is closed and need not change, so every display composition is animated. A panel at 64 pixels gains nothing from a still that costs a little less. The API cannot animate an existing image, so the browser's still is a separate drawing of the same idea. A frame of a 512-pixel GIF would look soft on a 1536-pixel card. The still sets the theme's palette and is what a display's fallback moves.

**Flare at low quality for all display art.** Sunburst may serve owner requests, but the trial showed the same reduced size at twice the latency and the same price, and physical quality is unknown. Its entry stays in the price table. Each entry's frame count is part of its key, since frames drive output.

**The GIF's own checks replace sheet validation.** Size, frame count and timing inside Pixoo's envelope are checked after a bounded decode. The returned GIF is always rebuilt, so what reaches a device has uniform timing and one palette. Which failures fall back: a wrong GIF and a definite failure. A moderation refusal stands, since procedural motion would stand in for art the provider refused to draw, and an unknown outcome stays uncertain because the call may still have run.

**`art-catalog-edit` is the module's own family.** `v2/art` carries only start and cancel, and #679's contract is not changed for this. Favorites, feedback, deletion and reuse need a tracked command, and a module may own one as Wemo's hold release does. It carries no provider work.

**A stage's fate comes from the core's `operation` records.** The module follows them by sync, as #679's fixture proves, keyed by each record's own request ID. A restart marks a pending stage uncertain, and a later record can still settle it. Nothing is resent.

**Bytes live in SQLite.** They commit with the rows that refer to them, so a crash leaves no orphan and no dangling reference, and they stay in the one private file a module owns. Display renditions are small; browser renditions and originals are bounded by `recentLimit`.

**Deletion leaves selection at once, and bytes when nothing refers to them.** An unexpired staged copy, or an uncertain or pending stage, is a reference. The row stays as a tombstone until then and the state reports the retained copy. This is the record's rule that deletion cannot remove media from an in-flight moment, with the honest limit that the module cannot reach into a device's store.

**Profile 1.8 for one span name.** The record asks #680 to register the span, and each profile's vocabulary is closed to earlier ones. The runtime moves to profile 1.8 because a host records only the span names of its selected profile.

## Risks / Trade-offs

- **GIF output is a preview.** Its limits differ from its guide, and no dated model version is listed. A refusal costs local motion, not the art's admission.
- **Display art costs more than a still would.** A GIF is about $0.02 against $0.005. The daily pace still bounds automatic work, and hourly ambient art stays well inside it.
- **The first month's image prices rest on one trial.** A settlement above its reservation records the true cost and logs a price table fault.

## Migration Plan

`art.sqlite` is new and created when missing, so an older reader never sees it. A section is required for the module to run, so an installation without one reports the ordinary absent module. Upgrade inventory and preflight admit the file and its owner. Rolling back leaves the store in place, and an older runtime's inventory refuses it, so a recovery needs the store set aside under the runtime's upgrade procedure.
