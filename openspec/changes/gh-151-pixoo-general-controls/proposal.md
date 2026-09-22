## Why

[Hub #151](https://github.com/jimmie-potts/agent-device-hub/issues/151) implements the first slice of the general-control definition accepted under [Hub #31](https://github.com/jimmie-potts/agent-device-hub/issues/31) and recorded in [ADR 0005](../../../docs/decisions/0005-general-device-controls.md). The delivered BUNNY component view exposes only Monitor/Media and monitor settings for Pixoo, although the Pixoo controller already declares screen power, brightness and media on [controller v1](../../../docs/controller-contract.md) through [Pixoo #37](https://github.com/jimmie-potts/divoom-app-upgrade/issues/37).

## What Changes

- Add general controls to the existing component view: screen power, brightness, saved-playlist selection and the six playback actions, usable without an observed agent session.
- Derive availability from the controller-declared capability, the credential's control scope and the Pixoo mode. Every disabled control names the missing capability, scope or mode.
- Disable playlist and playback controls while Pixoo presents agent status, with a one-click explicit switch to Media through the existing mode control. No command changes the mode as a side effect; nothing restores automatically.
- Submit one guarded controller v1 command per control through the existing hub route with the snapshot's request ticket, configuration revision and generation, showing pending, conflict, typed-failure and uncertain states with retained drafts.
- Route the Pixoo Monitor/Media mode control through the delivered Pixoo integration extension, which is where the real controller accepts mode changes; align the fake Pixoo fixture with the real controller's declared capabilities.
- List playlists by ID until [Pixoo #67](https://github.com/jimmie-potts/divoom-app-upgrade/issues/67) supplies names; that extension is separate and non-blocking.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `unified-dashboard`: component views gain capability- and scope-driven general controls with Pixoo Monitor gating, an explicit Media switch and per-command guards; the previous exclusion of general controls is removed while exact previews stay excluded.

## Impact

Changes `apps/dashboard` source, its browser fixtures and tests, the dashboard evidence and README, the hub route tests, `docs/development.md` and the maintained work guide. The hub route, the controller v1 wire contract and the Pixoo integration extension are unchanged; the hub still validates every request and keeps native credentials server-side. No hook, installation, agent session, state migration or device operation is part of this change. Physical acceptance on the display is [Hub #154](https://github.com/jimmie-potts/agent-device-hub/issues/154); human approval of the actual UI candidate is recorded in the PR under the SDLC UI approval scope.
