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

## 5. Review fixes (PR #965)

- [x] 5.1 Configure every shipped module in the maintenance intake test's clean run and the `shipped` disposable run from the factory's `simulatedSection` (#968's field), with the LIFX factory's simulated pendant and Beam.
- [x] 5.2 Assert, red before the fix, that a job past its command's deadline sends nothing and ends `failed` with `expired`, that a write after a read that outlasted the deadline is never sent, and that a mode change past its deadline changes nothing; check the deadline before every packet and before the write.
- [x] 5.3 Assert, red before the fix, that after a crash a command still waiting in the queue is reported `failed` with `cancelled`; mark the work begun inside the job, just before the write, and fail the command with no effect when the store cannot mark it.
- [x] 5.4 Assert, red before the fix, that a second instance on the same state directory reports none of the live one's commands; settle only the commands of bulbs whose lease the instance holds.
- [x] 5.5 Hold a bulb's lease in a child process and in the same process, and give each lease refusal its own reason and refusal text.
- [x] 5.6 Test a refused command's rollback, a mode change whose outcome cannot be stored, a session copy that ends after it synced, a bulb that comes back while a reader syncs, and a stop with a call in flight; read an unavailable bulb on demand, and end a call only when its transport says it ended.
- [x] 5.7 Look for every simulated bulb's address in the catalog's leak check.
- [x] 5.8 Show each fix's mutant fails its named tests, synchronize the specifications and rerun the gate.

