## 1. Base and restoration

- [x] 1.1 Write failing fake-light tests for a Start over a plain colour, a colour temperature, an unsaved scene, an effect and `*ExtControl*` frames, with Stop, alert and source-loss endings. Then add `readMusicBase` and `restoreMusicBase` and pass them. Verify with `music-session.test.ts`.
- [x] 1.2 Keep the streaming entry's manual check against the base's own selection, and the newer-choice guard between a colour restoration's writes. Verify with session tests.
- [x] 1.3 Model a plain colour in the simulated controller. Verify a Start over a colour, a colour temperature, an effect and an earlier session's frames through the module in `module-music.test.ts`.

## 2. Selection in the record

- [x] 2.1 Keep the last read selection from the Start's read and the playing check, with no added request, in `nanoleaf_selections`. Keep an unchanged selection's read time for up to a minute. Verify with store and session tests.
- [x] 2.2 Publish `selection` and `musicBase` on `nanoleaf-wall` with no scene name, and name the selection in a refused Start's detail. Verify with the module test and schema validation.

## 3. Dashboard

- [x] 3.1 Explain what an ending puts back before Start, during a session and after its ending, from the shell's existing `nanoleaf-wall` copy. Verify with the dashboard unit test and the Music lighting browser journey.

## 4. Documentation and delivery

- [x] 4.1 Update the Nanoleaf README's live-session description and the dashboard README where its facts change.
- [x] 4.2 Run build, typecheck, lint, Nanoleaf, runtime dashboard unit and Music lighting browser, and workflow checks, and record the actual results.
- [x] 4.3 Sync and archive this change on the delivery branch. Independent Standards and Specification review, a focused device-command safety review and #1614 AC4 on the installed Lines follow outside this change.
