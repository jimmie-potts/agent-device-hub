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

## 4. Review (PR #852)

- [x] 4.1 Release the slot a held key showed when pressed, share the `Detent` with the big wheel, reserve knob 4's click in profile validation and retitle the downgrade test (evidence: the paging-during-hold router test and the knob 4 click profile assertions).
- [x] 4.2 Mark the attention-only indicator as a pickup default pending the owner, add the unread and paging-during-hold installed checks, and add the rollback profile step and the beyond-pages attention note to the README (evidence: README, design and the qualification report). Decision 2026-10-05: the owner kept the attention-only indicator ("We can keep it with the current setting of attention only."); the README, design and qualification report record it, and the unread installed check stays as an observation.

## 5. Verification harness (#853 handoff, after PR #855)

- [x] 5.1 Add the `task-pages` catalog scenario (18 tasks across two pages) and make readiness check only the visible page's keys (evidence: `test:chompi-bridge:scenarios`, `scenarios.test.mjs`, and `scenario-task-pages` in `verify/tests/steps.test.mjs`).
- [x] 5.2 Give knob 4's LED a `page` light role and start knob 4's turn at one page step on the control page (evidence: `panel.test.mjs`, `verify/tests/page.browser.mjs`, the `controls-page` step).
- [x] 5.3 Add the `chompi-bridge-verification` delta, synchronize the spec, and update the verification README (evidence: the synced spec matches the delta).
