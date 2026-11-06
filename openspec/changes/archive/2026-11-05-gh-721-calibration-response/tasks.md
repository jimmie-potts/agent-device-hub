## 1. Contracts and measurement

- [x] 1.1 Add additive closed control/state 2.2 contracts and migrate bundled version selection/readers; demonstrate failing then passing bounds/compatibility tests with unchanged earlier schema files.
- [x] 1.2 Implement the bounded quiet-measurement collector connected to core admission; fake clocks verify post-admission coverage, gaps, clipping, format, deadline, distinct clock origins and elapsed-time uncertainty boundaries.

## 2. Core state and responsibility

- [x] 2.1 Persist settings/evidence and current qualification through existing capture transactions; disposable core tests verify Apply conflicts, cancellation, independent Stop and no producer work from tuning commands.
- [x] 2.2 Fence calibration and application bindings on source/freshness/format/clock loss, restart and storage refusal; restart/failure tests verify retained evidence and no replay or partial settings, including clock loss after Apply without measurement and after candidate completion.

## 3. Shared response and UI

- [x] 3.1 Share one browser-safe response function with explicit renderer V2; synthetic Lines/NL22 and preview parity tests preserve V1 output and reject incompatible recipes.
- [x] 3.2 Add accessible calibration/tuning controls, raw-versus-response preview and inactive qualification presentation; focused component tests cover uncertainty, conflicts, draft retention and independent Stop.
- [x] 3.3 Exercise the complete journey against a disposable runtime with synthetic features, including desktop/phone, keyboard, reduced motion, light/dark appearance and axe; inspect generated evidence.

## 4. Source qualification and handoff

- [x] 4.1 Update owning guides and scoped development checks, retaining existing CI discovery; verify instruction/readback and no installed or physical claims.
- [x] 4.2 Run required build/type/lint, event/SDK/runtime/producer/Nanoleaf/dashboard and workflow checks; record exact results and specification inventory, keeping unrelated failures separate.
- [x] 4.3 Reconcile the private candidate onto actual merged prerequisites, renew affected evidence, synchronize every affected specification and archive this exact change after current successful lookups.
- [x] 4.4 Freeze a committed comparison for independent Standards/Specification and focused state-safety review; hand publication and tracker reconciliation to the coordinator.
