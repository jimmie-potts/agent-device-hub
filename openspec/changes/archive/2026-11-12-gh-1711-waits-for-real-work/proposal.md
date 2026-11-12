## Why

[#1711](https://github.com/jimmie-potts/agent-device-hub/issues/1711) put every catalog capture on virtual time (pull request 1787). On virtual time a wait passes in milliseconds of real time, so wherever the run adapter moves the run's time and then reads something that real work must have finished, the slack the real clock gave is gone. Two such places are fixed: a restart's wait for the reader (pull request 1787) and a dropped reader's resync (pull request 1793). The review of pull request 1793 found a third, live delivery to the reader's stream, and that pull request left two risks of the same kind: an expectation's bound counted only in the run's time, and a call in flight. Delaying the reader's stream by 30 ms per chunk, its reconnect by 500 ms, an action's answer by 1 s or the reader's resync after a restart by 1 s each fails `scenario-end-to-end` on virtual time, while the same delays pass on the real clock.

## What Changes

- On virtual time a wait ends only once the reader holds what the run published while its stream was open and subscribed: every occurrence and outcome, and in each copy that has synced and not stopped, its owner's latest state or removal of each entity at that revision or later. The wait fails after 15 s of real time, naming what did not arrive.
- On virtual time an expectation whose bound has passed in the run's time keeps looking, without moving the run's time, while real work is in flight: a call waiting for its answer, a part's stream reconnecting, the reader's resync or a delivery to it, or the run's own work. It fails once none is in flight, or after 15 s of real time with text naming what is still in flight.
- On virtual time a restart's wait for the reader advances the run only while the reader's stream is away. Once the stream is back, the run's time stands still while the copies resync, so their deadlines on the parts' clock cannot pass under real I/O.
- The spec and the verification README describe these waits and the dropped reader's resync wait added by pull request 1793.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `bunny-runtime`: the requirement "A disposable run on virtual time" adds the waits for real work (the reader's resync after its stream's return, deliveries to the reader and an expectation's overtime), each with its 15 s real-time bound, and changes a restart's resync wait to hold the run's time once the reader's stream is back.

## Impact

- `apps/runtime/verify/adapter.ts`, `apps/runtime/verify/tests/adapter.test.ts` and `apps/runtime/verify/README.md`.
- `apps/runtime/tests/scenarios/framework.ts`: an optional `overtime` on the `Harness`, which only the run adapter implements; the in-memory harness is unchanged.
- `apps/runtime/tests/scenarios/parts.ts`: the reader records each copy's owner and whether it stopped, says what of a list of published messages it lacks, and tells its harness when it hears or syncs anything.
- No product code, product duration, message format, error shape or gate-policy file changes. A run on the real clock is unchanged, except that its two waits for the reader's resync (after a restart, and after an explicit disconnect) now look again as soon as the reader changes, and at least every 25 ms as before.
