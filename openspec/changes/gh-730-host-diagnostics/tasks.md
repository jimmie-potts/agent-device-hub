## 1. Shared runtime and consumers

- [ ] 1.1 Register focused runtime/package checks in docs and CI; implement explicit Node host construction through a red/green local/fake-Collector test, preserving no-op imports, canonical output and sampled trace correlation.
- [ ] 1.2 Add the pinned Python host adapter; verify canonical local/OTLP output, explicit thread context, unavailable sink and bounded concurrent shutdown with focused Python tests.
- [ ] 1.3 Package artifact 1.1.0 without altering schema profiles or immutable 1.0.0 input; verify reproducible external Node/Python consumers, types, browser purity and checksum corruption detection.

## 2. Hub application adoption

- [ ] 2.1 Wire private opt-in configuration, lifecycle/error logging and shutdown into the normal Hub host; verify enabled/disabled CLI readiness and output channels with synthetic state.
- [ ] 2.2 Cover authenticated HTTP/MCP, shared controller dispatch and representative owned background work; verify success/error/context/queue cases and unavailable collection preserve outcomes and one effect.
- [ ] 2.3 Document enable/disable, query examples and concrete coverage/deferrals; inspect against actual hooks and targeted tests.

## 3. Integration and specification

- [ ] 3.1 Run required shared, observability and owning Hub/package/setup checks, browser conformance and workflow validation; preserve results and any unrelated failures in canonical evidence.
- [ ] 3.2 Synchronize both affected capabilities and archive the completed change after current lookups; verify strict spec/workflow checks before final review.

The coordinator then obtains both independent reviews against the same committed base/head, verifies all required CI, performs the guarded merge, verifies merged-revision CI, reconciles tracker acceptance and publishes the immutable consumer pin. These delivery gates remain mandatory and are recorded outside the reviewed source.
