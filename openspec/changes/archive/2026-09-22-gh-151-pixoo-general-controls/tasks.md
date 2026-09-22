## 1. Fixtures and route evidence

- [x] 1.1 Align the fake Pixoo controller with the real controller v1 declaration (power, brightness 0–100, media with six actions and playlist IDs, modes unsupported) and apply power, brightness and media commands with revision checks; verify with the existing browser suite still passing.
- [x] 1.2 Add a hub route test that forwards a valid brightness command, rejects an undeclared media action or invalid brightness before contacting the controller, and refuses a read-only credential; observe it failing on the assertion order, then passing, without exposing native credentials.

## 2. Dashboard controls

- [x] 2.1 Add general-command builders and unit tests proving power, brightness, playlist and action commands carry the observed ticket, revision and generation; observe the failing test first, then green.
- [x] 2.2 Render the general-controls section with capability- and scope-driven availability and named reasons in every component view; verify through browser checks on Pixoo, Nanoleaf and the synthetic component.
- [x] 2.3 Route the Pixoo mode form through the integration `mode` operation, gate content controls on the observed and pending mode, and add the one-click Media switch; verify in the browser that Monitor disables content controls with the reason, the switch sends one mode command, and Media enables them.
- [x] 2.4 Show pending, conflict, typed-failure and uncertain states for drafted controls and one-click actions, keeping drafts and locks; verify with browser scenarios for revision conflict and a lost response with no automatic retry.

## 3. Qualification and delivery

- [x] 3.1 Extend browser and matrix scenarios for read-only credentials, no observed sessions, reconnect and resync draft preservation, keyboard access, reduced motion, narrow layout and axe checks on the extended view; refresh the committed evidence receipts.
- [x] 3.2 Update the dashboard README, development notes, roadmap/architecture mentions and the work guide inputs and generated output; verify guide generation, maintenance tests and browser checks.
- [x] 3.3 Run the shared build, type, hub, workflow and dashboard checks; present the exact UI candidate for human approval in the PR, synchronize the spec delta and archive this change. Independent reviews, current-head CI, renewed UI approval after changes, guarded merge and merged-main readback remain SDLC gates after archive.
