## Why

[#1272](https://github.com/jimmie-potts/agent-device-hub/issues/1272) needs the first admitted live effect: direct Music.app measurements driving one Nanoleaf Lines effect through the existing single writer. [#40](https://github.com/jimmie-potts/agent-device-hub/issues/40) recorded the owner's accepted first-trial policy on 2026-11-05. Start is explicit and only on lights already in Free. Alerts, manual takeover and source loss stop the effect. Nothing resumes automatically and the microphone is never a fallback. Restart is explicit, and Stop returns to the current base presentation. [#722](https://github.com/jimmie-potts/agent-device-hub/issues/722) needs truthful session and interruption state.

## What Changes

- Add four additive profile-2 families: `music-lighting-control`, `music-lighting-state`, `music-lighting-work` and `music-lighting-device`, all at 2.0.
- Add a core part that owns one music-lighting session record per target light. It admits explicit Start and Stop against the core's current Music capture session, dispatches tracked work to the light's module and records the device's reported ending without ever resuming.
- Add Nanoleaf execution for Lines. A frozen saved reactive preset renders the latest fresh Music feature through the existing locked worker. The session ends on Stop, alert, newer manual change, source loss or device failure. Stop and alert restore the current named Free base only while nothing newer has taken over.
- Expose the module's per-light session record through sync, so the core and later UI read state without polling.

## Capabilities

### New Capabilities
- `music-lighting-session`: Core-owned explicit Music lighting sessions with first-trial admission, interruption and return.

### Modified Capabilities
- `nanoleaf-module`: Live Music execution on Lines through the existing worker.

## Impact

Changes cover `packages/event-contracts` (new families, schemas, fixtures and tests), `apps/runtime` (core part, tracker and gateway admission) and `modules/nanoleaf` (live session, worker branch and served state). Existing capture, playback, moment, animation and preset contracts are unchanged. There is no dashboard control in this increment, and no microphone input, NL22 live rendering, installation, real capture or device command. #725 owns physical cadence and appearance.
