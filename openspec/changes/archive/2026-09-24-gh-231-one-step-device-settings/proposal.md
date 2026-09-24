## Why

[Hub #231](https://github.com/jimmie-potts/agent-device-hub/issues/231) records the friction the owner found in BUNNY's device controls during the [Hub #154](https://github.com/jimmie-potts/agent-device-hub/issues/154) and [Hub #155](https://github.com/jimmie-potts/agent-device-hub/issues/155) hardware checks. A successful brightness or power change leaves its form locked until **Discard edit / load current** is pressed. The status text is hard to read. Pixoo advances its [controller v1](../../../docs/controller-contract.md) generation on every playlist item, so playback actions and drafts built from an earlier snapshot fail with `stale-generation`, and a Pixoo brightness draft shows "Changed by another client" every few seconds during Media. BUNNY also offers no way to resend the active mode. That leaves no way to end a Nanoleaf brightness override, or to start a configured but inactive Pixoo Monitor, without switching away and back.

## What Changes

- After an explicit apply settles with an outcome that is not uncertain, wait for the refreshed snapshot, then clear the draft and unlock the form. It is ready for the next change without another click. Uncertain and partly applied results stay locked until **Reload current values**.
- Immediately before sending a controller v1 command, a Pixoo mode command or a Pixoo **Start Monitor** command, read the device again. Use that read's request ticket, configuration revision and generation. Re-check the control's availability against it. A general-control draft conflicts only when the configuration revision changed, not the generation. A failed read, a changed configuration revision or a newly unavailable control sends nothing. A remaining `stale-generation` race reports that nothing changed and leaves the action available for one more explicit press. Nothing is resubmitted automatically.
- Replace the pending, queued, sent, saved, not-applied, uncertain and partly applied messages with plain sentences that name the reason and whether anything changed. Keep the rule that transport success is not a physical result. Rename the unlock action to **Reload current values** and the draft discard action to **Discard my edit**.
- Add **Reapply <mode>** for controllers that declare controller v1 modes, including Nanoleaf. It sends one controller v1 `mode.set` for the observed mode, which ends power and brightness overrides and reapplies that mode's policy. Add **Start Monitor** for Pixoo when it is configured for Monitor but not presenting. It sends one Pixoo integration `mode: monitor` command and is unavailable while the screen is known to be off.
- Make the fake controllers match the real ones used by the browser fixtures. A generation mismatch fails as `stale-generation`. Any Nanoleaf mode command ends overrides, and a same-mode command with nothing to reapply is `cancelled` with no effects. A Pixoo Monitor mode command starts presentation only while the screen is on.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `unified-dashboard`: general controls and explicit mode actions read fresh guards before sending and settle drafts in one step. Status wording and the explicit reload action change. Same-mode reapply and Pixoo Start Monitor are added.

## Impact

This change touches `apps/dashboard` source, its browser fixture, unit and browser tests, evidence receipts and README, plus the dashboard mentions in `docs/development.md`. The hub routes, the controller v1 wire contract, the Pixoo and Nanoleaf integration validators and the pinned controller fixtures do not change. Pixoo's generation semantics stay as they are; BUNNY owns the friction fix, as the owner decided on the issue. Nothing here installs hooks, launches agent sessions, migrates state or operates a device. Physical acceptance stays with Hub #154 and Hub #155. The PR records the owner's review of the wording and explicit approval of the actual UI candidate under the SDLC UI approval scope.
