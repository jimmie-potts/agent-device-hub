## Why

[Hub #782](https://github.com/jimmie-potts/agent-device-hub/issues/782) shipped in PR #988. Its Acceptance review passed with three P3 findings, which this change settles:

- A disposable run answered `GET /api/v2/families/stand-in-history` with 404: the verify child passed the fixture core's stand-in history schema to neither its edge nor its gateway, so the PR's tier-2 steps that read history could not be followed in a run.
- The `bunny-runtime` spec said a restart lets every pending action reach its deadline. A clean stop settles the dispatcher's own requests first, so an action that its owner's handler holds unanswered ends `uncertain` at once, and one still queued is cancelled.
- The spec and the action route's 404 detail said a family that "no module in the runtime answers" is `not-found`. The route returns `not-found` only when the runtime knows no schema for the family; a known family with no running module is tracked and refused with `unavailable` (503).

## What Changes

- **Disposable runs.** The verify child registers the stand-in history schema with its other fixture schemas, so a run serves `stand-in-history` as the in-memory harness does. A verify test reads it and `inbox-item` in a real run.
- **Clean stop wording.** The "Action dispatcher and tracker" requirement and a new scenario name the clean stop: a held, unanswered action ends `uncertain` at once with `the requester closed before the reply`, and a queued one ends failed with `cancelled`. A tracker test shows both, and that the restart sends neither and the deadline adds nothing. The runtime README and the tracker's header say the same.
- **`not-found` wording.** The "Action routes" requirement, the route's 404 detail (now `this runtime knows no schema for this command family`) and the runtime README say that only an unknown family is `not-found`; a new scenario and test show that a known family with no running module is tracked and answered 503 `unavailable`.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `bunny-runtime`: "Action dispatcher and tracker" names the clean stop, and "Action routes" names `not-found` and `unavailable` as the code does.

## Impact

- **Code:** `apps/runtime/verify/child.ts` (schemas), `apps/runtime/src/gateway/gateway.ts` (the 404 detail and a comment), `apps/runtime/src/core/tracker.ts` (a comment).
- **Tests:** `apps/runtime/tests/tracker.test.ts`, `apps/runtime/tests/actions.test.ts`, `apps/runtime/verify/tests/supervisor.test.ts`.
- **Docs:** `apps/runtime/README.md`.
- **Design:** none. The spec-driven schema makes `design.md` optional, and this change makes no design decision: it registers a fixture schema and aligns wording with behavior the code already has.
- **Unchanged:** every contract, the dispatcher's behavior, coordinator-owned files. #976 (health latency under 300 to 400 concurrent actions) is a tracker hand-off, not code.
- **Delivery:** source-only.
