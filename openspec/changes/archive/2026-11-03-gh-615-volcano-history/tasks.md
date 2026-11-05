## 1. Contract and admission

- [x] 1.1 Add `volcano-observation/2.0` with its fixtures; evidence: `packages/event-contracts/tests/families.test.mjs` (valid, invalid and bounds)
- [x] 1.2 Add the family and key to `ingest`, bind it to the derived collector credential, and keep it out of history; evidence: `apps/runtime/tests/volcano-gateway.test.ts` (wrong-source and wrong-key refusals before the bus)

## 2. Facts and sessions

- [x] 2.1 Reducer for transitions, samples, counters, gaps, discontinuities and snapshot order; evidence: `modules/volcano/tests/facts.test.ts`
- [x] 2.2 Read-time sessions matching #614's worked examples, with regrouping; evidence: `modules/volcano/tests/sessions.test.ts`

## 3. Module

- [x] 3.1 Private store, outbox publication, device and status state, staleness; evidence: `modules/volcano/tests/module.test.ts`, `modules/volcano/tests/kit.test.ts`
- [x] 3.2 Restart, commit-to-publication and full-disk faults; evidence: `modules/volcano/tests/module.test.ts`
- [x] 3.3 Fixed reads, bounds and the status tool; evidence: `modules/volcano/tests/content.test.ts`
- [x] 3.4 Threshold command through the tracked dispatcher; evidence: `modules/volcano/tests/module.test.ts`, `apps/runtime/tests/volcano-gateway.test.ts`
- [x] 3.5 Simulation and shipped catalog scenario; evidence: `apps/runtime/tests/scenarios/modules/volcano.ts`

## 4. Collector

- [x] 4.1 Write-free transport, allowlist, identity, poll, publication and backoff; evidence: `apps/runtime/tests/volcano-collector.test.ts`
- [x] 4.2 Noble adapter in its own locked package, against a fake that fails on a write; evidence: `apps/volcano-collector/tests/noble-transport.test.ts`, `tests/volcano_consumer.test.mjs`
- [x] 4.3 A real collector loop on a fake radio through the edge to the reads; evidence: `apps/runtime/tests/volcano-gateway.test.ts`

## 5. Checks and docs

- [x] 5.1 Add `test:volcano`, `test:volcano:built`, `test:volcano:consumer:built`, CI steps and the selection rule, with the guide in `docs/development.md`; evidence: `tests/ci_selection.test.mjs`, `npm run check:workflow`
- [x] 5.2 Teach the upgrade inventory and preflight the new owner; evidence: `apps/runtime/tests/volcano-upgrade-profile.test.ts`
- [x] 5.3 Module, collector and contract documentation; evidence: readback
