## 1. Protocol

- [x] 1.1 Qualify the NL22 external-control protocol from Nanoleaf's OpenAPI documentation and the module's code, with no device contact, and record the documented and assumed points in `design.md`. Verify by readback of the table and its sources.
- [x] 1.2 Write failing `stream.test.ts` cases for the version 1 entry, answer port, datagram layout and address limits, and for the simulated Panels' strict version 1 stream. Then add `streamProtocol`, `streamPacketV1` and `streamPortV1` and pass them, with the Lines' version 2 bytes unchanged.

## 2. Sessions

- [x] 2.1 Write failing session tests for NL22 Start, frames, port, pacing, Stop, alert, source loss, newer choices, unnamed base, failed send, lost entry answer and an answer without a port. Then admit the NL22 by layout and enter its stream by kind in `music-session.ts`, passing the port through the link, worker and remote registration. Verify with `music-session.test.ts`, with the Lines tests unchanged in intent.
- [x] 2.2 Refuse a layout the stream cannot address before any device request. Verify with a session test on wide IDs and too many panels, and a Lines layout with two-byte IDs.
- [x] 2.3 Establish whether all five effect families are admitted: run a saved preset of each family on the Lines and the NL22 against the base, then add the tests. Verify that the Lines pass on the base and both lights pass after the change.
- [x] 2.4 Replace the module test that refused the Panels with independent Lines and NL22 sessions over the simulated controllers: version 1 frames to the Panels only, a Lines takeover that leaves the Panels playing, a Panels Stop that writes nothing to the Lines, a Start outside Free, and an alert ending both. Verify with `module-music.test.ts`.

## 3. Dashboard

- [x] 3.1 Replace the Lines-only capability hint. Verify with the dashboard unit test.
- [x] 3.2 Add a simulated NL22 to the Music lighting journey and start and stop it from its own section. Verify with two runs of `music-lighting.browser.ts`.

## 4. Documentation and delivery

- [x] 4.1 Update the Nanoleaf README's live-session section, and the development guide's Music lighting checks, where their facts change.
- [x] 4.2 Run build, typecheck, focused lint, the Nanoleaf, runtime dashboard, runtime music-lighting and Nanoleaf scenario checks, OpenSpec validation and the workflow checks, and record the actual results.
- [x] 4.3 Sync and archive this change on the delivery branch. Independent Standards and Specification review, a focused device-command safety review, and #725's installed and physical acceptance follow outside this change.
