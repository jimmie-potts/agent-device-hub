## 1. Port input and safe errors

- [x] 1.1 Assert, red first, that a shared-input configuration needs no 1.x endpoint or token file, and that selection and acceptance save no copy of the core's sessions (`shared-input.test.ts`, module input).
- [x] 1.2 Keep the previous envelope in an in-memory `SharedCopy`, thread it through selection, acceptance, failure reports and evictions, and compare the copy's text in the trace replay.
- [x] 1.3 Assert, red first, that journal outcomes carry the registry's error detail (`journal.test.ts`); build them with `errorBody`, widen `Outcome.error`, and remove the `bunny/safe-errors/nanoleaf-outcomes` block and its docs row.

## 2. The module

- [x] 2.1 Add the module's configuration, simulated controllers, device links, session feed, views, edits and runtime under `src/module/`, with its payload schemas.
- [x] 2.2 Assert, with a manual clock and a simulated Lines controller, the Lines following synced sessions with waves and comets; Work, Quiet and Free; play refused outside Free; favorites absent from the read state with a sync that writes nothing; a moment refused; observed power; an uncertain write held and not retried; a restart replaying nothing; an offline wall at start with one degradation and one recovery; notice acknowledgment and its refusal for a skipped session; and two devices (`module.test.ts`).
- [x] 2.3 Assert the three wall-editor ownership rules and a stale revision (`module.test.ts`), a new configuration paused and selected again, a stale generation refused, and a command and an edit answered while the worker waits on the wall.
- [x] 2.4 Run the module test kit, its offline check included (`module-kit.test.ts`).

## 3. Runtime

- [x] 3.1 Ship the Nanoleaf factory after the core, register the device families at the edge, and update the shipped process and log tests.
- [x] 3.2 Assert, under the runtime with its lag check, that a mode command and an edit are answered while the worker waits on the wall (`apps/runtime/tests/nanoleaf.test.ts`).
- [x] 3.3 Add the `nanoleaf-wall` catalog scenario and play it in memory on both transports, and in disposable runs, whose supervisor holds the simulated controller.

## 4. Documentation and qualification

- [x] 4.1 Document the module (`modules/nanoleaf/README.md`), update PORTING.md, the runtime and verify READMEs and the Nanoleaf section of `docs/development.md`.
- [x] 4.2 Show each protection's negative control fails its named tests.
- [x] 4.3 Run build, typecheck, lint, the SDK, runtime, scenario, verify, event, workflow and Nanoleaf checks, and OpenSpec validation.
- [x] 4.4 Synchronize the affected specifications and archive the change.

## 5. Review fixes (PR #968)

- [x] 5.1 Hold a device only after a write that may have reached it: an expired command holds nothing, and a hold is shown as `degraded` and `held` and logged once each way. Complete a mode command as `observed` when its mode commits, with no expiry.
- [x] 5.2 Take a device's HTTP error as its answer: the command fails with `transmitted` evidence and the status's code, and nothing holds.
- [x] 5.3 Publish the device record only when it changed, and keep `observedAtMs` as the reading that first showed the published values.
- [x] 5.4 Measure the event loop only around the held request, with a high lag limit, and read the saved layout and scene again only when their file changes.
- [x] 5.5 Start a worker that ended on a store failure again with capped backoff, and never let a publication or selection failure fail the module.
- [x] 5.6 Test expiry without a worker, machine-edit expiry, the overflow resync, the worker start after an accepted command, the selection's revision bump and the restart's ends, each with a negative control.
- [x] 5.7 Give favorite refusals their own text, use `invalid-state` for a missing layout, import the SDK's `errorType`, record device-call spans and create the lock files with mode 600.

## 6. Review fixes, round 2 (PR #968)

- [x] 6.1 Answer a sync with the requested families only, so syncing `device` alone from the module works.
- [x] 6.2 Show every write that reached the device in `lastTransmission`, the module's own paints and HTTP error answers included: a change that includes a command's write at once, a change from paints alone at most once every 5 s.
- [x] 6.3 Measure the lag test's stall as the held request starts, below the link's deadline, and while it is held, and assert the hold before the link gives up.
- [x] 6.4 Keep one pending worker restart per device, count a failed pass's recovery only while a worker runs, and log a refused token once.
- [x] 6.5 Test the publication retry against an idle poll, and name #975 for the hold field.
- [x] 6.6 Keep the last transmission as its own saved fact, apart from the last outcome, so an outcome that sent nothing, a poll or a restart never changes it (round 2b).
- [x] 6.7 Read a device's status within 5 s once it answers any request after an outage, not at the end of the backoff (round 2b).
