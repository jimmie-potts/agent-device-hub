## 1. Shared runtime and consumers

- [x] 1.1 Register focused runtime/package checks in docs and CI; implement explicit Node host construction through a red/green local/fake-Collector test, preserving no-op imports, canonical output and sampled trace correlation.
- [x] 1.2 Add the pinned Python host adapter; verify canonical local/OTLP output, explicit thread context, unavailable sink and bounded concurrent shutdown with focused Python tests.
- [x] 1.3 Package artifact 1.1.0 without altering schema profiles or immutable 1.0.0 input; verify reproducible external Node/Python consumers, types, browser purity and checksum corruption detection.

## 2. Hub application adoption

- [x] 2.1 Wire private opt-in configuration, lifecycle/error logging and shutdown into the normal Hub host; verify enabled/disabled CLI readiness and output channels with synthetic state.
- [x] 2.2 Cover authenticated HTTP/MCP, shared controller dispatch and representative owned background work; verify success/error/context/queue cases and unavailable collection preserve outcomes and one effect.
- [x] 2.3 Document enable/disable, query examples and concrete coverage/deferrals; inspect against actual hooks and targeted tests.

## 3. Integration and specification

- [x] 3.1 Run required shared, observability and owning Hub/package/setup checks, browser conformance and workflow validation; preserve results and any unrelated failures in canonical evidence.
- [x] 3.2 Synchronize both affected capabilities and archive the completed change after current lookups; verify strict spec/workflow checks before final review.

The coordinator then obtains both independent reviews against the same committed base/head, verifies all required CI, performs the guarded merge, verifies merged-revision CI, reconciles tracker acceptance and publishes the immutable consumer pin. These delivery gates remain mandatory and are recorded outside the reviewed source.

Validation: Node 24 build/type; observability Node/Python/query/package/browser and all 186 pilot regressions; shared contract/lifecycle/state/MCP suites and external packages; Hub, packaged Hub, MCP and setup checks passed. Workflow tests passed after updating the exact dependency-install assertion. Both synchronized capabilities passed strict validation (37 specs). No live installation or physical qualification was performed.
