## 1. Core

- [x] 1.1 Move the run's guard sequence into `checkAction` and keep `step` on it; the existing `power-schedules.test.ts` guard, mode, busy and drift cases still pass, and a direct `checkAction` case shows that only a fully passing record is returned.
- [x] 1.2 Add `preview(id)` on `createRoutines`; `power-schedules.test.ts` shows, for every guard, that the preview's reason equals the reason the run then logs and its detail names the guard, with no send, log row or claim after the preview, `busy · in-flight` while an occurrence runs, `not-found` for an unknown routine, and `no-evidence` for a failed read.

## 2. Gateway

- [x] 2.1 Serve `GET routines/<id>/preview` under read scope and add it to the route normalizer; `automation-gateway.test.ts` shows the reply shape for a reader, no new log row, the request span's route, 401, `not-found` 404, 404 for other methods, 400 for a query and `unavailable` 503.

## 3. Dashboard

- [x] 3.1 Add the Preview button, the declared reply-shape check and the inline result; `automation.test.ts` shows a header-free GET, an envelope-free reply and refusal of malformed verdicts, and `automation.browser.ts` shows the rendered verdicts, no mutation, no log row and clearing on refresh in Linux.

## 4. Scenario and records

- [x] 4.1 Preview the Pixoo/LIFX routine in Work in the `routine-actions` scenario before Run now records the same reasons; run it, `weekly-routines` and `automation-lines-moment` over both transports in Linux, and record the run in the PR.
- [x] 4.2 Update the runtime README's routines section and route list, the dashboard README and DEVELOPMENT.md, validate this change strictly, synchronize `bunny-power-schedules` and archive the change on the delivery branch before final review.
