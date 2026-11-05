## 1. Contracts and checks

- [x] 1.1 Add the owning guide, `test:weather` commands, build/type entries and modules CI coverage.
- [x] 1.2 Define the closed `weather-state` and `weather-changed` families; conformance proves served sync and message validity.

## 2. Reading the service

- [x] 2.1 Implement the bounded client and its reduction to the vocabulary; synthetic response tests cover shape, coverage, rate limit, outage, malformed and stale data.

## 3. Owner

- [x] 3.1 Implement polling, backoff, truthful unavailable state and the persisted change baseline; fixed-clock tests cover AC1, AC2 and AC4 across an outage and a restart.
- [x] 3.2 Prove the location reaches no message, sync, log, prompt word or stored row, with a negative control.

## 4. Runtime admission

- [x] 4.1 Register the shipped module and teach container admission and the upgrade preflight its absent and configured states.
