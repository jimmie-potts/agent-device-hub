## 1. Gateway entry

- [x] 1.1 Add a failing real-listener test for an authenticated HTTPS proxy owner session; retain the red result, then implement optional configuration, exact origin/proxy admission and Secure cookie behavior until the same test passes.
- [x] 1.2 Exercise missing/forged proof, wrong Host/Origin, browser-only admission, cookie expiry/logout and preserved local clients through focused gateway tests; verify no secret appears in diagnostics.

## 2. Setup and browser use

- [x] 2.1 Provide the small removable Windows Caddy configuration and setup recipe; validate its syntax and check TLS, password refusal, header handling, streaming and removal in a disposable setup.
- [x] 2.2 Exercise the existing dashboard at phone width through HTTPS, including navigation, a simulated control, disconnect/resume, no replay and accessibility; retain browser/disposable evidence without physical-device effects.

## 3. Integration

- [x] 3.1 Update owning guides and verification instructions; run the required build, type, lint, runtime, SDK, contracts, workflow and browser checks and report any unrelated failure separately.
- [x] 3.2 Synchronize both capability deltas and archive this change after source acceptance is evidenced. Keep installed upgrade, network/certificate setup and actual iPhone acceptance in the owning issue and private delivery record; source tests do not complete those gates.

Source evidence: five focused Wi-Fi tests and 30 adjacent gateway tests pass;
738 runtime tests, shared SDK/events/contracts/package/workflow checks and the
existing dashboard smoke/full browser suite pass. The native Windows forwarding
probe validates TLS/auth/headers/stream/removal; the Chromium HTTPS phone-width
journey validates synthetic controls, no replay and axe. Optional desktop WebKit
could not start because host libraries need administrator installation. Actual
Safari, installed setup and network restriction evidence remain pending in #1111;
this archive records source behavior only, not completion of the installed story.
