## Context

See proposal.md. `ControllerClient` owns one bounded slot per controller and today validates 1.0 only. The contract package provides `validate('snapshotV1_1', ...)`, `negotiateApiVersion` and `downgradeSnapshot`, and its documentation fixes the client rule: a controller that serves only 1.0 may answer a versioned read with `invalid-request`, and the client then reads again without the signal. Existing hub tests use fakes that return a 1.0 snapshot to every read and count the reads they see.

## Goals / Non-Goals

Goals: a hub-side 1.1 reader that costs one extra read per controller epoch, keeps every 1.0 reader byte-compatible and sends no command.

Non-goals: controller feed reads at 1.1, a timed re-probe, the moment sender and its command path (#335), showing moments in a page (#336, #432, #360), and any change under `packages/contracts`.

## Decisions

**Verdict state lives in the client and only in memory.** A `1.0-only` verdict names the epoch of the 1.0 answer that produced it. It is not stored, so a hub start probes again and no durable state, credential or token is added. A 1.1 answer is remembered as `1.1` for reporting only and never changes how the next read is sent, because a 1.1 controller that later restarts as 1.0-only is detected by the ordinary `invalid-request` answer.

**Negotiation sends one versioned read first.** Probing first keeps a 1.1 controller at one read. With a verdict, the read is unversioned and its epoch decides: the same epoch keeps the verdict, a new epoch drops it and probes at once, reusing the unversioned answer already in hand if the probe is refused, so a restart of a still 1.0-only controller costs two reads once.

**Only an exact `invalid-request` refusal counts.** The verdict follows a 400 answer with the exact `failure.code: invalid-request` envelope, which the client already maps to a typed error. Timeouts, 5xx answers, transport errors and malformed bodies map to `controller-unavailable` or `incompatible-controller` and leave the verdict alone. A 1.0 answer to a versioned read, which a controller that negotiates but serves only 1.0 gives, is valid per the contract and records the verdict without a second read.

**The whole negotiation runs inside one slot.** The slot moves from `request` to a wrapper that both `request` and negotiation use, so a fallback read cannot admit another caller between its two reads and the one-slot-per-controller bound holds. Each read keeps its own timeout.

**Default reads stay plain.** A read that does not ask for 1.1, such as the dashboard poll or `GET .../snapshot` without a parameter, sends no version parameter. A controller that serves 1.1 gives its own `downgradeSnapshot` view to a 1.0 reader, so the hub neither probes on polls nor rebuilds the 1.0 shape. The issue mentions the hub applying `downgradeSnapshot`, which the plain read makes unnecessary: the controller applies the same contract function, the observable 1.0 shape is identical and existing hub tests keep their exact request expectations.

**The route accepts one parameter.** `apiVersion` is `1.0` or `1.1`, exactly once, with no other parameter. The hub does not forward caller-chosen values, so `1.2` and malformed values fail with 400 before any controller read.

**One shared fake.** `apps/hub/tests/fake-controller.mjs` builds its documents from the contract fixtures, validates them, and negotiates with `negotiateApiVersion`, so the fake cannot drift from the contract. Its name does not match `*.test.mjs`, so no test runner treats it as a suite while the package test still copies it.

## Risks / Trade-offs

- A controller that starts serving 1.1 without an epoch change stays 1.0-only until restart or hub start → the timed re-probe is a recorded deferral.
- A probe costs one extra read for every 1.0-only controller after each hub start → bounded by the slot, and the fallback read is the read the caller wanted anyway.
- A controller that answers the versioned read with `invalid-request` for another reason gets a fallback read that fails the same way → the verdict is recorded only after the unversioned read succeeds.

## Migration Plan

Source only. Nothing is installed, migrated or contacted. Rollback is the previous hub build, because no state or wire value changes for 1.0 readers.
