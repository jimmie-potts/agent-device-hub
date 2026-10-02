# Shared event contracts

Private source package `@jimmie-potts/event-contracts` 1.0.0 defines the
[B.U.N.N.Y. CloudEvents profile](../../docs/event-contract.md). No runtime
producer/transport is enabled. Existing lifecycle and controller formats remain
unchanged; consumers must select an explicit adapter before adopting this profile.

- `schemas/event-v1.schema.json`: closed Draft 2020-12 profile, registry bindings
  and typed payload definitions. Schema identifiers are resolved locally.
- `src/index.ts`: TypeScript types, bounded `validateEvent(unknown)` and pure
  `referenceDecision(unknown)`; build emits `dist/`.
- `python/event_contracts`: Python `validate_event` / `reference_decision` with
  the same rules and schema. Keep this directory beside `schemas/`.
- `fixtures/events-v1.json`: language-neutral validation and reference cases;
  both runners assert every case's expected result and immutable input.

Run `npm run test:events` and `npm run test:events:python` from the repository
root using Node 24 and Python 3.12/3.14. The Python runner uses the repository's
`requirements-contracts.txt`. Shared build/type/workflow and compatibility checks
are documented in [development](../../docs/development.md#shared-event-contract-checks).

Validation returns `{ok:true,value}` with detached data or
`{ok:false,code:"invalid-event"}`. It applies JSON structure/ASCII and byte limits,
then schema shape and calendar, occurrence, reference and validity-window rules.
Callers must enforce transport bytes before parsing. It does not authenticate a
source, verify a claimed durable commit or detect a secret encoded as a permitted
neutral ID. Do not hand in executable objects such as proxies.

`referenceDecision` accepts one of two closed example inputs:

- `{operation:"retry",event,prior}`: `prior` is null or the retained event with
  which to compare identity. Returns `new`, `duplicate`, `conflict` or `invalid`.
  The caller owns retention and lookup; this function creates no cache.
- `{operation:"delivery",event,recovery,nowMs,acceptance,handling,delivered}`:
  booleans mark historical recovery and delivery acknowledgment; `nowMs` is a
  nonnegative safe integer; acceptance is `unconfirmed`, `confirmed`, `failed`
  or `ambiguous`; handling is `pending`, `handled` or `expired`. Outputs are
  the reference actions shown in the shared corpus. Input has the same structural
  bounds as validation. Confirmed acceptance and explicit expiry are supplied
  evidence, not facts derived from this envelope or function.

`eligible-live-effect` means only that this reference window/recovery check
passes. A real evaluator still needs authorized policy, fresh state, mode and
generation checks and the designated controller queue. `read-snapshot` is a
reconciliation instruction, not a stored snapshot or complete history. Notification
results express an obligation under a future selected policy, not an implemented
store, queue, automatic retry or human acknowledgment.

No separate repository may depend on a mutable checkout path. Before external
adoption, publish a versioned private artifact with an immutable source receipt
and checksum and run that consumer's contract tests. This source package is not
a public registry release and is not installed by source delivery.
