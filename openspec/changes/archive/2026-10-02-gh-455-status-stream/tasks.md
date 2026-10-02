## 1. Shared feed and lifecycle

- [x] 1.1 Establish red tests for concrete SSE subscription, fixed polling and cancellation.
- [x] 1.2 Implement bounded existing-wire parsing, validation, reconnect and cleanup with fake stream coverage.
- [x] 1.3 Add independent recovery polling and cancelable read waits, preserving one evaluation/one rerun.

## 2. Consumers

- [x] 2.1 Connect both publishers; test notice latency/storms and stop during pending reads/lookups.
- [x] 2.2 Verify modes/manual control, LIFX transitions/outages and Tidbyt cadence/refresh/backoff/stale display; document source-only limits.

## 3. Acceptance

- [x] 3.1 Run Node 24 build/type, shared contracts/lifecycle/state, affected consumers and workflow checks.
- [x] 3.2 Synchronize the specification and verify archive readiness before final independent review.
