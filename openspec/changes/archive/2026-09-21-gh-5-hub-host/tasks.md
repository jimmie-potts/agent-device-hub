## 1. Host foundation

- [x] 1.1 Add Node 24 host build/type/test commands and CI coverage; verify setup and a meaningful failing storage test before implementation.
- [x] 1.2 Implement private durable Linux storage; verify cross-process exclusion, atomic revision conflicts, abort, restart and persistent fences.
- [x] 1.3 Implement authenticated bounded sessions/events/commands/changes; verify privacy, scope, revocation, replay, reconnect, slow clients and independent health.

## 2. Controller and migration integration

- [x] 2.1 Implement fixed-target shared-v1 controller clients; verify malformed responses, timeouts, cancellation, ambiguous writes and offline-device isolation.
- [x] 2.2 Integrate the delivered Nanoleaf settings extension with pinned compatibility fixtures and owning-service tests; prove credentials never enter responses.
- [x] 2.3 Integrate Pixoo #33 monitor settings after its API is delivered; verify mode/filter/conflict fixtures and preserve released controller v1.
- [x] 2.4 Implement fenced migration and rollback tooling; exercise the actual Pixoo selected-source facade, producer/consumer readiness, failed/interrupted cutover and rollback after new writes.

## 3. Delivery evidence

- [x] 3.1 Package the host reproducibly; verify isolated installation, configuration, readiness and graceful shutdown without private credentials or sibling imports.
- [x] 3.2 Measure responsiveness against the frozen early budget; retain failures and distinguish integrated qualification under #30.
- [x] 3.3 Update architecture, development, compatibility and guide inputs/output; run guide maintenance/browser checks and record pending publication separately.
- [x] 3.4 Run all applicable local checks and current OpenSpec validation, ready for specification sync/archive before final review.
## Delivery gates after archival

These gates remain mandatory and are tracked on PR #121. They are not completed implementation tasks: the repository requires archival before final review and merge.

- Obtain independent Standards and Specification reviews of the same committed base/head and resolve blocking findings.
- Require every applicable current-head CI job to pass, then recheck scope/base/head and perform the guarded squash merge.
- Verify all merged-main CI jobs before checking acceptance and closing #5.
- Reconcile newly confirmed guide history and tracker facts in a linked follow-up PR. Keep public publication, installation and physical acceptance separate.

## Local acceptance evidence

All 18 setup/product/type/contract/performance/package commands exited zero. The host suite passed 29 tests. The final package rerun verified both migration subpath imports and all installed host tests. Nine migration cases include interruption, original enablement recovery and failed-start child cleanup. Independent intermediate Standards review accepted the three migration repairs at `3082e755`.

Owning-service checks pinned Pixoo `28f4875b7a0f0e57ca6f25d9971e125e927a5503` and Nanoleaf `f12ac6653a9f3267fa9ef62a2d6667072183d8b3`; receipts and measurement boundaries are in `apps/hub/evidence/`. The latest API workload passed 9,000 samples with 165.44 MiB peak RSS against the owner-approved 256 MiB limit. Original failed measurements remain unchanged. Full integrated qualification remains #30; budget and memory follow-up remains #123.

Guide generation, five maintenance tests and browser checks passed with 98 primary open issues, 12 guides and nine diagrams. Each diagram passed all nine deterministic artifact checks. Browser evidence and known viewer overflow are recorded in the guide maintenance entry. Public publication is pending.

Final review FSPEC-5 required binding consumer readiness to a live supervised Pixoo child and its exact selected configuration. The missing-facade regression, invalid consumer proofs, actual Pixoo cutover and offline package checks passed after repair. Final review/CI remain separate delivery gates.
