## Why

[#722](https://github.com/jimmie-potts/agent-device-hub/issues/722) needs explicit start and stop for live Music lighting, with truthful session state (AC2, AC3, AC5). [#1272](https://github.com/jimmie-potts/agent-device-hub/issues/1272) added the core-owned `music-lighting-*` sessions and Lines execution, with no dashboard control. The accepted first-trial policy in [#40](https://github.com/jimmie-potts/agent-device-hub/issues/40) (2026-11-05) requires explicit Start on lights already in Free, no automatic resume after any ending and no microphone fallback. The operator needs to see each light's session and its last ending, then start or stop it deliberately.

## What Changes

- Add a **Music lighting** card on the Audio page, beside Music input measurement. For each light in the core's synced `music-lighting-state` records, it shows the session status, the preset in use and the last ending (reason, restoration and code).
- Add a saved reactive preset choice read from the private Nanoleaf library with the Wall page's own follower, plus explicit Start and Stop through the shared tracked command path. Start binds the record's revision and the current active Music.app capture endpoint and generation. Stop stays available for every session that is not idle.
- Keep the operator command's outcome, the light module's work outcome and the light's reported session state as three separate lines.
- Show stale or unavailable reads as last known, with controls disabled and an explicit read retry.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `runtime-dashboard`: explicit Music lighting controls and truthful session state on the Audio page.

## Impact

Dashboard source (`apps/runtime/dashboard`): a read-only lighting scope on the shell participant, a presentation model, the card, unit tests and a browser journey. The journey runs in the Music-card browser entry and hosted smoke. The Nanoleaf package gains one additive browser export, `./reactive-presets`, for its existing catalog follower. Contracts, the core, the Nanoleaf module's behavior and the capture card's controls are unchanged. There is no installation, real capture, microphone or physical device command; #725 owns installed and physical acceptance.
