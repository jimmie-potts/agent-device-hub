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
- [x] 4.3 Sync and archive this change on the delivery branch. Independent review, a focused device-command safety review and the installed NL22 check under owner-approved terms follow outside this change.
