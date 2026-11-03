## Context

`docs/art-generation-qualification.md` owns the route, the job and result shapes, the case table, the spending rules and the handoff. #679 owns the command and dispatch families and #1418 owns weather. Neither is on `main`, and #679 is in progress beside this change. ADR 0012 gives each module its own SQLite file and outbox, and forbids automatic resends.

## Goals / Non-Goals

**Goals:** every case and trace in the record holds on fake providers; spend is inspectable per provider; favorites and the ledger survive a restart; a module can be wired to #679 and #1418 by replacing one default each.

**Non-Goals:** device responders, dashboard widgets and scheduling (#681, #682, #684, #1288); defining #679's families; real provider calls; a general asset store.

## Decisions

**Separate limits per provider, one loop guard.** The owner's decision of 2026-11-03 names ceilings and paces per provider and one guard of about 30 images an hour. The guard exists to stop a runaway loop, which is one failure however its calls are spent, so idea and image calls share one count.

**The daily pace counts all of a provider's spend that day.** Owner requests therefore use up automatic room. The alternative, counting only automatic calls, would let automatic art spend its full pace on top of a heavy owner day, and the pace is meant to bound the day. Owner requests themselves are never limited by the pace.

**Limits are edited in the section.** A module has one configuration path (`ModuleSettings`), and a change takes effect at the next start. An edit command would need a family that #679's set does not name. The state shows the limits in force.

**`reserved` and `dispatched` are separate committed steps.** A dispatched mark commits before any send, so a restart knows which calls may have run: a `dispatched` call becomes `uncertain` and keeps its reservation, and a `reserved` one provably never left and is released.

**A variation sends no input image.** The record refuses any input image without an observed price entry, and none was observed. A variation is a new request built on the source's saved idea and names its source in `variationOf`.

**A failed idea call does not fail the art.** The call keeps its own row and terms. The prompt falls back to the owner's words or an imagined scene, and that fallback costs nothing. Image calls never fall back to another provider.

**Sharp reduces and `gifenc` quantizes.** `sharp` 0.35.4 did not honor `colours` in a probe: its PNG and GIF output held 256 colors from a request for 32. `gifenc`, already pinned for Pixoo, enforces a shared 32-color palette for stills and GIFs. Sharp still does the Lanczos reduction.

**Sheet validation has three checks.** A grid that does not divide the image, a subject crossing a cell edge, and a scene that a small shift explains are misaligned. More than 512 of 4,096 pixels changing noticeably between frames, about twice the trial's largest, is excess change. These thresholds rest on one real sample and synthetic fixtures, so the state counts accepted and rejected sheets for #687 to measure.

**Bytes live in SQLite.** They commit with the rows that refer to them, so a crash leaves no orphan and no dangling reference, and they stay in the one private file a module owns. Display renditions are small; browser renditions and originals are bounded by `recentLimit`.

**Deletion leaves selection at once, and bytes when nothing refers to them.** An unexpired staged copy, or an uncertain or pending stage, is a reference. The row stays as a tombstone until then and the state reports the retained copy. This is the record's rule that deletion cannot remove media from an in-flight moment, with the honest limit that the module cannot reach into a device's store.

**Unwired seams refuse.** The shipped module registers no command until #679 merges, and a stage answers `unavailable`, so nothing is offered. This is safer than a guessed wire format, and the module's tests bind the same handlers through a fake seam.

**Profile 1.8 for one span name.** The record asks #680 to register the span, and each profile's vocabulary is closed to earlier ones. The runtime moves to profile 1.8 because a host records only the span names of its selected profile.

## Risks / Trade-offs

- **Two traces cannot be proved here.** Gateway and tracker refusal of `art-auto` and `art-request` sit in code #679 changes. They stay as named `todo` tests and move to real checks at integration.
- **Sheet validation may over-reject full-bleed scenes.** Rejection costs a call and falls back to local motion, so the risk is cost and not correctness. The counts expose it.
- **The first month's image prices rest on one trial.** A settlement above its reservation records the true cost and logs a price table fault.

## Migration Plan

`art.sqlite` is new and created when missing, so an older reader never sees it. A section is required for the module to run, so an installation without one reports the ordinary absent module. Upgrade inventory and preflight admit the file and its owner. Rolling back leaves the store in place, and an older runtime's inventory refuses it, so a recovery needs the store set aside under the runtime's upgrade procedure.
