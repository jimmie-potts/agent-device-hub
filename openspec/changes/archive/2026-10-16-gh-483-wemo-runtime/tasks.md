## 1. Runtime integration and transport

- [x] 1.1 Add the fixed module workspace and owning validation/CI commands before product behavior; verify Node 24 installation, registry discovery and type/build checks.
- [x] 1.2 Implement bounded identity-checked local SOAP transport test-first; prove reads, on/off, wrong identity/origin, oversized/malformed replies, timeout and uncertainty without retries through loopback tests.
- [x] 1.3 Implement independent queued device owners, durable request fences/outbox, freshness, writer leases and explicit held-write release; verify module conformance plus duplicate, restart, disk failure and two-target tests.

## 2. Independent Hub maximum-on enforcement

- [x] 2.1 Implement separate limit definitions/run persistence and tracked off evaluation test-first; prove repeat-on, observed external transitions, unknown start, edits/disable, restart, offline/held/uncertain fences and no schedule re-on.
- [x] 2.2 Integrate authenticated bounded management and per-device controls; verify origin/scope changes during body reads, truthful status/age, independent schedules/settings and browser/accessibility behavior with synthetic targets.

## 3. Delivery gates

- [x] 3.1 Update owning module/runtime/development/architecture guides and selected recovery/verification coverage; run required build/type/lint/contracts/workflow and affected runtime/SDK/module/browser checks.
- [x] 3.2 Obtain current successful OpenSpec lookups, synchronize both specifications and verify archive prerequisites for the final candidate.
- [x] 3.3 Prepare the reviewable source candidate and evidence, with independent reviews, hosted CI, guarded merge, merged-main verification, tracker reconciliation, installed recovery qualification and physical acceptance retained as delivery gates outside this implementation checklist.
