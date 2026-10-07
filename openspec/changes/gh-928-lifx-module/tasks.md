## 1. Copied code and tests

- [x] 1.1 Copy the protocol, the per-bulb queue and the writer lease from `controllers/lifx` and the Tidbyt runner into `modules/lifx`, with provenance notes, under the strict profile and the module boundary (`src/protocol.ts`, `src/queue.ts`, `src/lease.ts`).
- [x] 1.2 Convert the copied tests to TypeScript on a manual scheduler, keeping their assertions, and map each case in the README (`tests/protocol.test.ts`, `tests/queue.test.ts`, `tests/status.test.ts`).

## 2. Module behavior

- [x] 2.1 Assert the module's commands, refusals, outcomes, restarts, full store, unreachable bulb, writer lease, on-demand read and spans with simulated bulbs on a manual clock (`tests/module.test.ts`); a mutation of each protection fails a named test.
- [x] 2.2 Implement `createLifxModule`: records, commands stored before the reply, outcomes through the outbox, settlement at start, policy A probes and the on-demand read (`src/module.ts`, `src/store.ts`, `src/families.ts`).
- [x] 2.3 Paint agent status from the synced sessions, only on a shown-key transition, never in Free, with the key kept across restarts (`src/status.ts`, `tests/status.test.ts`).
- [x] 2.4 Add `configure`, the cutover's conversion and the old mode-file reader (`src/configuration.ts`, `src/conversion.ts`, `tests/configuration.test.ts`).
- [x] 2.5 Pass the module test kit with the offline check (`tests/kit.test.ts`).

## 3. Runtime

- [x] 3.1 Add the module to the shipped list after the core and register the device families at the edge; the process and log tests expect each shipped device module refused without a section.
- [x] 3.2 Add the `lifx-bulbs` catalog scenario, played in the in-memory harness on both transports, and in disposable runs with the supervisor's simulated bulbs over IPC; watch the module's sources and serve its build (`build.test.ts`).

## 4. Documentation and qualification

- [x] 4.1 Document the module, the conversion and the expected webcam result for #840 in its README; update the runtime and verify READMEs, the old controller's README and `docs/development.md`, and add `test:lifx-module:built` to CI.
- [x] 4.2 Run build, typecheck, lint, the module, SDK, runtime, scenario, verify, event, LIFX controller and workflow checks, and OpenSpec validation.
- [x] 4.3 Synchronize the affected specifications and archive the change.
