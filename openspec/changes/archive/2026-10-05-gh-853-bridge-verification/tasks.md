## 1. Simulated parts

- [x] 1.1 Simulated desktop behind OS adapter interface version 3, selected only by `run --desktop sim` (evidence: `tests/adapter-contract.test.mjs` runs the same expectations against the test fake and the simulated desktop; `tests/sim-cli.test.mjs` shows usage errors, no `src/sim` import without the flag, and a routed slot press with neither the HID transport nor the platform adapter created).
- [x] 1.2 Synthetic Hub feed with a run-generated token, in memory and over HTTP (evidence: `tests/sim-hub.test.mjs` reads it with the real feed client, including reconnect, the 1.2 fallback and token refusal).

## 2. Scenario catalog

- [x] 2.1 Six scenarios as data plus step functions, with a runner that stops at the first failure (evidence: `tests/scenarios.test.mjs`: negative controls for a failed expectation, a throwing action and a broken hold, and a catalog scenario that fails at its own step on an unestablished card).
- [x] 2.2 Tier 1 command `npm run test:chompi-bridge:scenarios` in the contracts CI job (evidence: all six pass; 25 sequential and 30 parallel repeats passed).

## 3. Verification runs

- [x] 3.1 `npm run -s verify:chompi -- <operation>` with build identity, readiness, components, capture steps and the three boundary checks (evidence: `verify/tests/boundaries.test.mjs` starts the three crossing runs and each check fails; `verify/tests/steps.test.mjs` passes every reference and scenario step and fails the negative control through `runCaptureStep`).
- [x] 3.2 Control page with keyboard operation and accessibility (evidence: `npm run test:chompi-bridge:browser`, axe WCAG 2.1 A and AA at 1440 px and phone width).
- [x] 3.3 One disposable run on the WSL host: start, one scenario capture with a screenshot, stop and cleanup (evidence: the run ID and proof under the main checkout's `.local/evidence/verify/`, recorded in the PR).

## 4. Review (PR #855)

- [x] 4.1 Address round 1: Tier 2 waits for readiness and the page gates Run scenario (`verify/tests/scenario-ready.test.mjs`); type-check the run's modules; byte-bounded request bodies; lights named by role (`tests/panel.test.mjs`); an accurate reconnect title; no stray axe video; per-crossing boundary wording; the one-run rule; negative controls labelled.

## 5. Documentation and validation

- [x] 5.1 Adapter README, bridge README, docs/app-verification.md, docs/development.md and docs/sdlc.md.
- [x] 5.2 Build, typecheck, the bridge suites, OpenSpec validation and the workflow checks; results in the PR.
- [x] 5.3 Synchronize the specs and archive this change.
