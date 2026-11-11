These tasks cover the source delivery. Issue #1743 keeps review, hosted CI, merge and the installed update with the owner.

## 1. Recordings

- [x] 1.1 Record two short real runs (a synthetic answer and a synthetic ambiguous brief) and the status commands, scrub them and check them. Evidence: `apps/runtime/tests/fixtures/claude-stream/recorded-*`; the fixture privacy test passes.

## 2. Contracts

- [x] 2.1 Add `coding-endpoint/2.1`, `coding-progress/2.1` and `coding-state/2.1` beside 2.0 with their checks, types and fixtures. Evidence: `packages/event-contracts/tests/coding.test.mjs` and `families.test.mjs` pass.

## 3. Worker

- [x] 3.1 Read the harness output as a stream and add the `usage-limit` and `waiting-for-owner` outcomes. Evidence: `coding-worker-stream.test.js` replays the recorded and constructed fixtures.
- [x] 3.2 Start the harness and its probes without provider credentials. Evidence: the environment tests fail with the filter weakened and pass with it.
- [x] 3.5 Review round 2: over-bound complete lines skipped in the same chunk, an injected probe deadline timer, configured-name rule, a limitation for changed project settings. Evidence: `coding-worker-stream.test.js`, with a negative control for each.
- [x] 3.4 Review round 1: allowlisted environment keeping the subscription token, project-settings refusal, first-event key-source stop, subscription-only `signedIn`, probe kill at deadline, budget precedence, line-splitting and fixture-guard regressions. Evidence: `coding-worker-stream.test.js`, with a negative control for each.
- [x] 3.3 Probe readiness before connecting, send it with the declaration and after a run that reported limit windows. Evidence: `coding-worker-stream.test.js`; `coding-worker-process.test.js` shows `installed: no` for a missing tool.

## 4. Coordinator

- [x] 4.1 Record readiness in `coding-state/2.1`, clear it on disable or loss, and describe the new outcomes. Evidence: `coding-coordinator.test.js`.

## 5. Qualification

- [x] 5.1 Owning build, type, lint, contract, runtime, companions and workflow checks; update the worker guide. Evidence: the PR's validation table.
