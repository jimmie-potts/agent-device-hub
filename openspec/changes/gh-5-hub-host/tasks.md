## 1. Host foundation

- [ ] 1.1 Add Node 24 host build/type/test commands and CI coverage; verify setup and a meaningful failing storage test before implementation.
- [ ] 1.2 Implement private durable Linux storage; verify cross-process exclusion, atomic revision conflicts, abort, restart and persistent fences.
- [ ] 1.3 Implement authenticated bounded sessions/events/commands/changes; verify privacy, scope, revocation, replay, reconnect, slow clients and independent health.

## 2. Controller and migration integration

- [ ] 2.1 Implement fixed-target shared-v1 controller clients; verify malformed responses, timeouts, cancellation, ambiguous writes and offline-device isolation.
- [ ] 2.2 Integrate the delivered Nanoleaf settings extension with pinned compatibility fixtures and owning-service tests; prove credentials never enter responses.
- [ ] 2.3 Integrate Pixoo #33 monitor settings after its API is delivered; verify mode/filter/conflict fixtures and preserve released controller v1.
- [ ] 2.4 Implement fenced migration and rollback tooling; exercise the actual Pixoo selected-source facade, producer/consumer readiness, failed/interrupted cutover and rollback after new writes.

## 3. Delivery evidence

- [ ] 3.1 Package the host reproducibly; verify isolated installation, configuration, readiness and graceful shutdown without private credentials or sibling imports.
- [ ] 3.2 Measure responsiveness against the frozen early budget; retain failures and distinguish integrated qualification under #30.
- [ ] 3.3 Update architecture, development, compatibility and guide inputs/output; run guide maintenance/browser checks and record pending publication separately.
- [ ] 3.4 Run all applicable local checks and current OpenSpec validation; synchronize/archive only after acceptance tasks are complete, then obtain independent fixed-comparison reviews and current-head CI.
- [ ] 3.5 Guard the eligible merge and verify merged-main CI and issue completion; reconcile guide facts without claiming installation or physical acceptance.
