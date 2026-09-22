## 1. Fixtures and route evidence

- [ ] 1.1 Align the fake Nanoleaf controller with Nanoleaf `8062849`: declare power, brightness 0–100 and scenes with discovered IDs, list one named and one unnamed scene in the integration snapshot, apply power and brightness commands, and reject `scene.activate` outside Free or for an undeclared ID with `unsupported-capability` and no write; verify with the existing browser suite still passing.
- [ ] 1.2 Extend the hub route test so a malformed scene ID is rejected before contacting the controller and a valid scene command is forwarded with the native credential; observe the failing assertion first, then passing.

## 2. Dashboard controls

- [ ] 2.1 Add the `scenes` availability reason and a scene-option helper with unit tests proving capability, scope and mode ordering, name-or-ID labelling and exclusion of IDs absent from controller v1; observe the failing tests first, then green.
- [ ] 2.2 Add the Nanoleaf mode-gating helper with unit tests for Work, Quiet, Free, pending mode change and unknown mode; observe red then green.
- [ ] 2.3 Render the scene group, the Nanoleaf power and brightness override hints and the one-click Free switch through the controller v1 mode command; verify in the browser that Work disables scenes with the reason, the switch sends one mode command, Free enables activation, and activation sends one guarded scene command with the observed ticket, revision and generation.
- [ ] 2.4 Show pending, typed-failure, conflict and uncertain states for the scene action, keeping drafts and locks; verify with browser scenarios for a controller-side rejection, a revision conflict and a lost response with no automatic retry.

## 3. Qualification and delivery

- [ ] 3.1 Extend browser and matrix scenarios for read-only credentials, no observed sessions, reconnect with a preserved scene selection and focus, unknown observation, keyboard access, reduced motion, narrow layout and axe checks on the Nanoleaf view; refresh the committed evidence receipts.
- [ ] 3.2 Update the dashboard README, development notes, README and architecture mentions and the work guide inputs and generated output; verify guide generation, maintenance tests and browser checks.
- [ ] 3.3 Run the shared build, type, hub, workflow and dashboard checks; present the exact UI candidate for human approval in the PR, synchronize the spec delta and archive this change. Independent reviews, current-head CI, renewed UI approval after changes, guarded merge after the Nanoleaf #64 hub companion and Pixoo #151 candidates merge, and merged-main readback remain SDLC gates after archive.
