## 1. Private preference owner

- [ ] 1.1 Establish a failing module preference-read scenario, then implement private record/history and active-only reads; verify restart and inactive-edit behavior with the real SDK SQLite helper (AC1/2).
- [ ] 1.2 Implement closed versioned export/additive import; verify existing IDs unchanged, missing IDs inactive, repeat/old import idempotence, malformed/version rejection and transactional rollback (AC3/4/5).
- [ ] 1.3 Integrate staged tracked controls and content-free revision sync; verify request binding, duplicates, expiry, persistence failure and restart without replay (AC5/6).

## 2. Dashboard and consumers

- [ ] 2.1 Add accessible manage/copy/export/import controls; verify active-only current copy, private history, keyboard, reader and disconnected behavior in the authenticated browser (AC1/2/6).
- [ ] 2.2 Add the shared runtime preference scenario and event-contract fixture; verify actual gateway grants, metadata privacy, restart and unchanged assistant/Reachy paths (AC5/6).

## 3. Integration and documentation

- [ ] 3.1 Document the private read/export contract, limits, same-store ownership and failure recovery; verify owning docs and current architecture remain accurate.
- [ ] 3.2 Run required build/type/lint, module/runtime/scenario/browser, contract/consumer and workflow checks; preserve red/green evidence and actual specification inventory.
- [ ] 3.3 Synchronize and archive the accepted spec change before the committed candidate's independent Standards, Specification and Acceptance reviews; retain review and CI evidence on the PR.
