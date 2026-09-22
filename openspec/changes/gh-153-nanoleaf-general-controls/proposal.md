## Why

[Hub #153](https://github.com/jimmie-potts/agent-device-hub/issues/153) implements the Nanoleaf slice of the general-control definition accepted under [Hub #31](https://github.com/jimmie-potts/agent-device-hub/issues/31) and recorded in [ADR 0005](../../../docs/decisions/0005-general-device-controls.md). Since [Nanoleaf #64](https://github.com/jimmie-potts/codex-nanoleaf/issues/64) merged as `8062849`, the protected Nanoleaf controller declares power, brightness and discovered saved scenes on [controller v1](../../../docs/controller-contract.md) and lists user-chosen scene names in its `nanoleaf.integration/1.0` snapshot, but the BUNNY component view still renders those controls disabled as undeclared.

## What Changes

- Enable Nanoleaf power, brightness and saved-scene activation in the existing Nanoleaf component view, usable without an observed agent session. Each control submits one guarded controller v1 command through the existing hub route with the snapshot's request ticket, configuration revision and generation.
- Derive availability from the controller-declared capability, the credential's control scope and the Nanoleaf mode. Power and brightness stay available in Work, Quiet and Free. Every disabled control names the missing capability, scope, stale or external-control evidence, or mode.
- Show the desired brightness as an override that persists until the next explicit mode command, matching the controller's policy from Nanoleaf #64; no override is shown as unknown, never as a value.
- Disable scene activation while the wall presents agent status in Work or Quiet, or while a mode change is pending, with the reason and a one-click explicit switch to Free through the existing controller v1 mode command. No command changes the mode as a side effect; nothing restores automatically; returning to Work or Quiet uses the existing mode control.
- List scenes only from the controller v1 `scenes` capability, labelled by the user-chosen names the `nanoleaf.integration/1.0` snapshot supplies and by ID otherwise. Browser and hub configuration contribute no scene identities or names.
- Align the fake Nanoleaf browser fixture with the released #64 declaration, including the typed `unsupported-capability` rejection of a scene command outside Free before any write.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `unified-dashboard`: general device controls extend to Nanoleaf power, brightness and saved scenes; content-control gating covers Nanoleaf Work and Quiet with an explicit Free switch through the controller v1 mode command; the brightness override display and scene naming rules are added.

## Impact

Changes `apps/dashboard` source, its browser fixture, unit and browser tests, evidence receipts and README, the hub route test, `README.md`, `docs/architecture.md`, `docs/development.md` and the maintained work guide. The hub route, the controller v1 wire contract, the hub's `nanoleaf.integration/1.0` validator and the pinned Nanoleaf fixtures are unchanged by this change; the scene acceptance and fixture pin come from the linked Nanoleaf #64 hub companion. No hook, installation, agent session, state migration or device operation is part of this change. Physical acceptance on the installed wall is [Hub #155](https://github.com/jimmie-potts/agent-device-hub/issues/155); explicit human approval of the actual UI candidate is recorded in the PR under the SDLC UI approval scope.
