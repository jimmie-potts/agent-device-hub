## Why

The coding worker (#502) is step 0 of the delivery orchestrator's build order, which the owner accepted on 2026-11-11
(#1722). The T3 Code study on #1722 found four gaps before more is built on it: the worker does not say whether its
tool is installed, signed in or near its limits; a run stopped by the plan's usage limit looks like any other failure;
an API key in the worker's environment would override the owner's subscription sign-in, and the owner decided that
workers use the subscriptions; and the tests use only a hand-written fake harness. Issue
[#1743](https://github.com/jimmie-potts/agent-device-hub/issues/1743) owns the scope and acceptance.

## What Changes

- The worker reports a readiness record without starting a task or a session: the tool's version, signed in or not or
  unknown, the plan where the tool reports one, and the limit windows the latest run reported. It probes before it
  connects, sends the record with its enable declaration, and after a run that reported limit windows sends one more
  enable from the selected endpoint with the new record. The companions coordinator records it in the coding state.
- The worker reads the harness's output as a stream (`--output-format stream-json --verbose`) instead of one final
  envelope, and keeps the structured result contract.
- Two more outcomes: `usage-limit`, with the window and reset time the tool gave or null where it gave none, ending
  `failed` with reason `usage-limit`; and `waiting-for-owner`, a completed run whose first finding is the question.
- The harness and its readiness probes start without provider credentials or provider switches.
- Recorded runs of the real tool, scrubbed and synthetic, are replayed through the real parsing code in tests.
- Contracts: additive `coding-endpoint/2.1`, `coding-progress/2.1` and `coding-state/2.1`, registered beside 2.0.

No new provider, no new host, no push or pull-request authority. The allowlist, fixed deny list, one task at a time
and the 20-minute, 60-turn and $5 bounds are unchanged. Nothing is retried automatically.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `bunny-coding-delegation`: worker readiness on the declaration and in the coding state; streamed output; the
  `usage-limit` and `waiting-for-owner` outcomes; a harness environment without provider credentials.

## Impact

- Worker: `apps/runtime/src/worker/coding-worker.ts` and the new `apps/runtime/src/worker/claude-stream.ts`; tests and
  fixtures under `apps/runtime/tests`.
- Companions: `modules/companions/src/coding/coordinator.ts` publishes `coding-state/2.1` and describes the new outcomes.
- Contracts: `packages/event-contracts` schemas, types, fixtures and tests for the three 2.1 versions. The credential
  role's families, the gateway grant and the dashboard are unchanged.
- Installation: source-only. The installed worker runs under the owner's sign-in and is updated in a separate step.
