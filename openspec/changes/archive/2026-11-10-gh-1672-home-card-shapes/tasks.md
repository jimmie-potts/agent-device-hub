These tasks cover PR A's source implementation and disposable acceptance. Issue #1672 keeps review, hosted CI, merge,
installation, PR B (module compact markup) and tracker closeout.

## 1. Stage A: design and size prototype

- [x] 1.1 Trace where the Home layout is stored and validated; propose the shape field, conversion and acceptance examples.
- [x] 1.2 Prototype the unit grid and packing, shape declarations and compact content for size screenshots.
- [x] 1.3 Capture synthetic screenshots for three unit candidates and the owner's open questions.
- [x] 1.4 Record the owner's choices (220px unit, no Inbox square, generic compact face) in this design.

## 2. Contract and core

- [x] 2.1 Write the acceptance examples from design decision 2 as failing contract, core and dashboard tests.
- [x] 2.2 Add `home-layout/2.2` with optional `shape`, point `home-layout-set/2.0` at it, and update types and the contracts guide.
- [x] 2.3 Publish 2.2 from the core; keep, drop or carry the shape on save and in lighting reconcile; prove restart, duplicate and stale saves.

## 3. Dashboard

- [x] 3.1 Fix the 220px unit and rows per page; remove the Stage A prototype shape override.
- [x] 3.2 Load shapes with the conversion table; write shape and agreeing size on Done, Reset and art actions.
- [x] 3.3 Replace the size select with the shape picker; keep the edit preview in real grid placement with holes marked.
- [x] 3.4 Compact content for Hub mode, Inbox, Agent sessions, Timeline, light, room and Nanoleaf cards; the generic compact face with Open for every other card.
- [x] 3.5 Opened list items take the page in a shaped card; Check Inbox keeps working; no row stays stuck across shape or width changes.
- [x] 3.6 Shaped pinned art with Unpin and Dismiss; automatic art in trailing empty cells; the visualizer fills its shape.
- [x] 3.7 Offered shapes limited to those that fit, checked by measuring every card and tab face in every offered shape.

## 4. Qualification

- [x] 4.1 Browser tests for AC1 to AC5 and keyboard order; journeys the grid changes updated with their reasons.
- [x] 4.2 Owning build, type, lint, contract, runtime, dashboard and workflow checks; final screenshots.
- [x] 4.3 Update the dashboard README, runtime development checks and the contracts guide; sync specs and archive this change.
