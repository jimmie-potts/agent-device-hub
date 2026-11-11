These tasks cover source implementation and disposable acceptance. Issue #1672 keeps the owner's D1 choice, review,
hosted CI, merge, installation and tracker closeout.

## 1. Stage A: design and size prototype

- [x] 1.1 Trace where the Home layout is stored and validated; propose the shape field, conversion and acceptance examples.
- [x] 1.2 Prototype the unit grid and packing, shape declarations for every catalog widget and compact Hub mode, Inbox, light and Pixoo content.
- [x] 1.3 Capture synthetic screenshots for three unit candidates and the owner's open questions.
- [ ] 1.4 Record the owner's D1 choice and answers to the open questions in the issue and this design.

## 2. Contract and core

- [ ] 2.1 Write the acceptance examples from design decision 2 as failing contract, core and dashboard tests.
- [ ] 2.2 Add `home-layout/2.2` with optional `shape`, point `home-layout-set/2.0` at it, and update types, fixtures and the contracts guide.
- [ ] 2.3 Publish 2.2 from the core; keep, drop or carry the shape on save and in lighting reconcile; prove restart, duplicate and stale saves.

## 3. Dashboard

- [ ] 3.1 Fix the unit and rows-per-page values from D1; remove the Stage A prototype shape override.
- [ ] 3.2 Load shapes from the record with the conversion table; write shape and agreeing size on Done, Reset and art actions.
- [ ] 3.3 Replace the size select with the shape picker; keep the edit preview in real grid placement.
- [ ] 3.4 Compact content for every card in the first compact set; an additive `FrontendContext` presentation hint for module frontends, rendered in the Pixoo, Tidbyt and Wispr modules.
- [ ] 3.5 Opened list items take the page in a shaped card; Check Inbox keeps working.
- [ ] 3.6 Shaped pinned art with its controls; automatic art in trailing empty cells; the visualizer fills its shape.
- [ ] 3.7 Final offered shapes for cards outside the first set, checked by measuring each card in each offered shape.

## 4. Qualification

- [ ] 4.1 Browser tests for AC1 to AC5 and updates to the Home balance, layout, paging, art and card journeys the grid replaces.
- [ ] 4.2 Owning build, type, lint, contract, runtime, dashboard, scenario and workflow checks; screenshots the owner has seen.
- [ ] 4.3 Update the dashboard README Customizable Home section and the contracts guide; sync specs and archive this change.
