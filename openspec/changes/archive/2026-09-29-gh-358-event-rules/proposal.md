## Why

[Hub #358](https://github.com/jimmie-potts/agent-device-hub/issues/358), child 1 of [#45](https://github.com/jimmie-potts/agent-device-hub/issues/45), delivers the part of [ADR 0006](https://github.com/jimmie-potts/agent-device-hub/blob/main/docs/decisions/0006-hub-moments-and-interludes.md) that the hub owns. Owner-approved event rules turn normalized events into moments without an open conversation or a model call. The owner's interrupt set decides which event kinds may cover status presentation. The hub arbitrates each moment before it reaches a device. Today the hub has no rules store, no event intake and no arbitration, so no event can trigger a moment.

## What Changes

- Add a rules store, an interrupt set and automation settings as relational tables in the hub's private `state.sqlite`, under the existing owner lock. The three owner-approved interrupt kinds (`pull-request.merged`, `ci.failed`, `meeting.reminder`) and the ADR 0006 settings defaults are seeded exactly once.
- Add one in-process event intake that sources call with a normalized event: a stable ID, a source, a kind and an explicit live or replay delivery. Duplicate IDs are dropped, including after a restart, and replayed events never reach a rule. The hub's agent lifecycle ingest becomes the first real source.
- Add arbitration for each matching enabled event rule, in this order: the global no-flourish switch, quiet hours (off by default), the per-agent, global and per-device flourish budgets, then each target's presentation and alert state. The hub derives `coversStatus`: true only for an `event` moment whose kind is in the interrupt set.
- Hand each arbitrated moment, once per target, to the shared single-device moment sender from [#335](https://github.com/jimmie-potts/agent-device-hub/issues/335), bound to that target's controller client. All targets share one hub-monotonic start instant and fan out concurrently. Nothing is retried.
- Add a bounded `automation_log` that records the rule, the triggering event, each target, and the receipt, the typed not-sent or uncertain result, or `blocked` with its reason.
- Add typed routes under `/api/automation/v1/` for rules (list, read, create, update, enable, disable, delete), the interrupt set, the settings and the log. Reads need `read` scope. Writes need `control` scope and the `X-Pixoo-Request: 1` header that every hub REST mutation already requires. A rule that targets a device also needs that alias in the caller's `devices`. Rules that anything other than the owner's explicit route call creates are stored disabled.

## Capabilities

### New Capabilities
- `hub-automation`: owner-approved event rules, the interrupt set, event intake, moment arbitration, delivery hand-off and the automation log in the standalone hub.

### Modified Capabilities
None. The existing hub routes, controller routing and agent ingest keep their requirements. The ingest route only forwards newly applied lifecycle events to the intake, and never waits for the result.

## Impact

- Code: new `apps/hub/src/automation.ts`, `automation-store.ts` and `automation-routes.ts`; `apps/hub/src/storage.ts` creates the tables on the owner lease; `apps/hub/src/server.ts` composes the intake, the routes and the lifecycle source.
- State: new tables in the private hub store. Existing agent-state payloads and migrations are unchanged. Automation tables do not move with a released-state migration.
- Docs: `apps/hub/README.md` (routes and scopes), `docs/architecture.md` (hub ownership of rules), `docs/development.md` (checks).
- Tests: `apps/hub/tests/automation.test.mjs` with a fake source, a fake sender and fake controllers.
- Dependencies: #335's sender, merged during this delivery. A device receives a moment only from a controller that serves contract 1.1 and declares `moments`. Installation and enabling a rule on the installed hub are separately authorized.
