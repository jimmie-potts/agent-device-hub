## 1. Checks and store

- [ ] 1.1 Add `npm run test:hub:automation` and its built variant, and document them with the automation scenarios in docs/development.md. The existing `test:hub:built` CI step picks up `apps/hub/tests/automation.test.mjs` through its glob; verify the script runs the new file.
- [ ] 1.2 Write failing restart tests (AC1): rules, the interrupt set and settings persist across a hub restart, and defaults seed exactly once, including after the owner empties the interrupt set. Then add `AutomationStore` on the owner lease and see them pass.

## 2. Routes

- [ ] 2.1 Write failing route tests (AC1): scopes, the `X-Pixoo-Request` header, device grants for targets, typed errors for invalid trigger, action, name, kind, interrupt set and settings, `unknown-rule`, rule capacity and staged refusal. Then implement `/api/automation/v1/` and see them pass.

## 3. Intake, arbitration and hand-off

- [ ] 3.1 Write failing intake tests with a fake source (AC2, AC5): interrupt-set and non-interrupt kinds give one hand-off per target with the derived `coversStatus`, a disabled rule and a duplicate ID give nothing, a restart does not reprocess an event, a replay stream reaches no rule, and a non-owner creation is stored disabled. Then implement the intake and see them pass.
- [ ] 3.2 Write failing arbitration tests with an injected target reader (AC3): the switch, quiet hours, each budget, device spacing, Quiet and an active alert each log their reason with zero hand-offs, in the stated order. Then implement arbitration and see them pass.
- [ ] 3.3 Write failing hand-off tests with a fake sender of the #335 shape (AC4): one call per target with one shared start instant, a thrown send, `moment-blocked`, `moment-missed` and `unsupported-capability` receipts, not-sent and uncertain results each logged while other targets are still handed over, no retry, and `sender-unavailable` without a sender. Then implement hand-off and the log and see them pass.
- [ ] 3.4 Forward newly applied lifecycle events to the intake, and verify with a hub test that a rule on `agent.turn.ended` fires once while a duplicate lifecycle event does not.
- [ ] 3.5 Run the AC2 to AC5 scenarios against the shared 1.1 fake controllers from #576, where it has landed, with the composed target reader, and verify that blocked moments make zero controller command POSTs.

## 4. Documentation and delivery checks

- [ ] 4.1 Document the routes, scopes and behavior in apps/hub/README.md and the hub's rule ownership in docs/architecture.md, and verify that the links resolve.
- [ ] 4.2 Run the build, typecheck, contract, package, workflow, hub, setup, hub MCP and MCP checks from the worktree root, record the results, and synchronize and archive this change. Independent reviews and CI evidence stay in the PR.
