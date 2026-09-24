## 1. Fixture fidelity

- [x] 1.1 Make the fake controller v1 reject a generation mismatch as `stale-generation` (409) separately from `revision-conflict`, and add a hook that advances a device's generation. Make the fake Nanoleaf end power and brightness overrides on any mode command and cancel a same-mode command with nothing to reapply, with no effects. Make the fake Pixoo report `participating` from the configured mode and requested screen power. Verified: the existing browser suite passed unchanged against these fixtures before any dashboard change.

## 2. Plain status text

- [x] 2.1 Add unit tests for the status function covering queued, sent, saved, already in effect, not applied with a reason and code, unknown result, partly applied, and the draft and action suffixes. Include tests that transport success never claims a physical result and that uncertain or possibly effective results lock. Observed 3 failing tests, then implemented them in `client.ts` and saw them pass.

## 3. Fresh guards and one-step drafts

- [x] 3.1 Make device and monitor refreshes resolve with a read that started after the call. Derive availability from one device read for both rendering and the pre-send check.
- [x] 3.2 Add browser scenarios in which the controller generation advances after render. A playback action and a brightness draft each send exactly one command with the current guards and show no conflict. A generation advance between the fresh read and the send is shown as `stale-generation`, with nothing changed, nothing resubmitted and the action still available. Run against the base dashboard, the scenario failed its first guard assertion (the command carried the rendered generation). Implemented fresh reads in the one-click hook and the draft form; the scenario now passes.
- [x] 3.3 Add a browser scenario in which an accepted brightness change and then an accepted power change leave each form unlocked and showing current values, with no discard step. Against the base dashboard, it timed out waiting for the settled status. The new wording is checked first, so this red run did not reach the lock assertion. Implemented one-step settling; the scenario now passes. Update existing scenarios that relied on the old lock and wording. Uncertain results must still lock until **Reload current values**.

## 4. Same-mode reapply

- [x] 4.1 Add browser scenarios for **Reapply Work** after a Nanoleaf brightness override, sending exactly one `mode.set` Work and then showing no override. Cover a same-mode command with nothing to reapply, shown as already in effect. Cover **Start Monitor** on an inactive Pixoo Monitor, sending exactly one integration Monitor command and no media command, and its disabled screen-off reason. Against the base dashboard, both failed because the actions were absent. Implemented both actions; the scenarios now pass.

## 5. Qualification and delivery

- [x] 5.1 Run keyboard, reduced-motion, narrow-layout and axe checks on both component views with the new actions, and refresh the committed synthetic evidence receipts.
- [x] 5.2 Update the dashboard README and the dashboard notes in `docs/development.md`.
- [x] 5.3 Run the shared build, type, contract, workflow, hub and dashboard checks. Present the exact UI candidate and wording for the owner's review and approval in the PR. Synchronize the spec delta and archive this change. Independent reviews, current-head CI, renewed UI approval after changes, guarded merge and merged-main readback remain SDLC gates after archive.
