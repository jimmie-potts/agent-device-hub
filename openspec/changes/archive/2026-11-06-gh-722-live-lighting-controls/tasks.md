## 1. Lighting scope and presentation model

- [x] 1.1 Add the read-only lighting scope and the record validator, eligibility, status, ending and outcome text, and work-ID derivation. Evidence: `tests/music-lighting.test.ts` covers foreign and malformed records, every Start and Stop reason, microphone exclusion, the three evidence texts, work-ID parity with the core and closing every copy.

## 2. Audio card

- [x] 2.1 Add the Music lighting card with the preset choice, explicit tracked Start and Stop, last-known stale display and explicit refresh. Evidence: `tests/music-lighting.browser.ts` on the real disposable core, gateway and Nanoleaf module with a simulated Lines controller and the numeric producer fixture. It covers no command on load, reload or reconnect; active, stopped, source-lost and refused-outside-Free endings; no automatic restart; a stale read; a lost Start reply without resend; read-only access; and microphone exclusion. Axe and overflow checks run at 1280, 390 and 320 px in both themes.

## 3. Validation and delivery

- [x] 3.1 Run build, typecheck, lint, dashboard unit tests, the browser journey on Linux and macOS, and the workflow checks; record actual results and platform limits.
- [x] 3.2 Update the dashboard README, runtime README and development guides; synchronize and archive this change.
