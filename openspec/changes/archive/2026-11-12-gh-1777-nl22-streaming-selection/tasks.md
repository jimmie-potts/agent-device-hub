## 1. Research

- [x] 1.1 Read Nanoleaf's Light Panels OpenAPI documentation (Confluence page 2789310530) for what the NL22 reports while in external control version 1, and for any read that tells streaming from an unsaved dynamic effect. Record the documented, observed and assumed points in `design.md`, with no device contact. Verify by readback of the table and its sources.

## 2. Tests first

- [x] 2.1 Make the simulated Panels report `*Dynamic*` while streaming, add app actions for a colour and an unsaved static or dynamic effect, and apply a datagram only while the controller is streaming. Write failing `stream.test.ts`, `music-session.test.ts` and `module-music.test.ts` cases: a Panels session past several checks; a scene, colour, static and dynamic pick mid-session; Stop, alert and source loss restoring a scene and a colour base; a Start over a leftover NL22 stream; and both lights running. Verify that they fail on the base because the session ends `manual` at its first check, and that every Lines test passes.

## 3. Fix

- [x] 3.1 Add the per-kind streaming selection to `StreamProtocol` and use it in the playing check and the restoration guard in `music-session.ts`. Verify that the focused tests pass and that the Lines' tests are unchanged in intent.
- [x] 3.2 Keep the selection-only manual-change rule, leave the restoration guard as the owner's policy requires, and record the option not implemented as a pending owner decision. Verify with the named limit test on the session and module levels.

## 4. Documentation and dashboard

- [x] 4.1 Update the Nanoleaf README (base, streaming entry, app takeover, restoration, Known limits) and the Audio card's `*Dynamic*` and manual-change text with its unit test. Make the Music lighting journey assert `*Dynamic*` and play past the first check.
- [x] 4.2 Run build, typecheck, lint, the Nanoleaf, runtime dashboard, runtime Music lighting and Nanoleaf checks, the scenario catalog, OpenSpec validation, the workflow checks and the Music lighting journey twice, and record the results.
- [x] 4.3 Sync and archive this change on the delivery branch. (Fix round 1 below updated the archived copy and the main specs together.)

## 5. Review fix round 1

- [x] 5.1 Describe the limit as anything that leaves the NL22 reporting `*Dynamic*` with brightness and power unchanged: an app dynamic effect, a temporary display from the app or an integration, and another external-control client. Mark the evidence that datagrams are ignored after an app pick as observed on the Lines only, state what happens if the NL22 keeps applying them, and add that question as an installed-check step. Verify by readback of the README, both spec copies, the design and the Audio card text and test.
- [x] 5.2 Correct the scene-restorer note (endings that leave the last frame, the mode-command pass, the fallback colour, the Lines' `*ExtControl*` exemption) and the unnamed-base entry window. List the owner's five options once, alike in the README, design D2 and the PR text. Verify by readback.
- [x] 5.3 Name the limit on the shared ending paths with tests: a colour base ending by Stop, and a scene base ending by an alert and by source loss. Verify that they pass with no behaviour change.
- [x] 5.4 Write failing tests for the colour-state diagnostic (parse, store with its once-a-minute rule, playing check, Start read, record on both lights, unchanged reads and outcomes), then keep the `/state` read's colour state with the selection in `nanoleaf_selection_colors` and publish it as optional `selection` fields. Verify with the session and module tests and the schema check in the module tests.

## 6. Review fix round 2

- [x] 6.1 (R4) Write a failing session test whose `/state` reports a different hue at every check, and a store test, then keep a changed colour mode at once and a change of only hue, saturation or colour temperature at the one-minute refresh. Add a store test for create-if-absent, reopen and an older writer. Verify with `music-session.test.ts`, the outcome-independence test kept green, and readback of the README, both spec copies and design D8. Independent review, a focused device-command safety review and the installed NL22 check under owner-approved terms follow outside this change.
