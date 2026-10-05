## 1. Acceptance examples first

- [x] 1.1 Write failing store, router, profile and lights tests for task pages, including the persistent-state examples: an interrupted write, a corrupt file and a downgrade (evidence: commit "Write acceptance tests for PROMPTI task pages").

## 2. Implementation

- [x] 2.1 Page the slot store (version 2 file, version 1 migration on read, pages set from the profile, slots beyond the pages kept) (evidence: `routing-slots.test.mjs`).
- [x] 2.2 Page the router with knob 4 detents, map keys, the release gesture and lights through the visible page, and add the page LED (evidence: `routing-router.test.mjs`, `routing-lights.test.mjs`).
- [x] 2.3 Add the optional `pages` profile section and `colors.pages`, and reserve knob 4's turn (evidence: `routing-profile.test.mjs`).

## 3. Documentation and validation

- [x] 3.1 Update the bridge README (profile, controls, lights, rollback), the qualification report (control map, installed checks for #822) and the development guide (evidence: those files).
- [x] 3.2 Run build, typecheck, the bridge suite, OpenSpec validation and the workflow checks; record results in the PR.
- [x] 3.3 Synchronize the spec and archive this change (evidence: the synced `chompi-task-routing` spec matches the delta).
- [x] 3.4 Hand the reinstall and the installed checks (more than 15 tasks, paging with knob 4, opening a page-2 task, the hidden-page attention light) to the coordinator and owner (evidence: their receipts go in the PR and on #822, not in this change).
