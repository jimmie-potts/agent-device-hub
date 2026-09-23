## Why

[Hub #19](https://github.com/jimmie-potts/agent-device-hub/issues/19) asks the Tidbyt to show shared agent status. The fake-tested cloud controller from [#16](https://github.com/jimmie-potts/agent-device-hub/issues/16) can render and push a 64×32 frame. The shared agent-state owner from [#3](https://github.com/jimmie-potts/agent-device-hub/issues/3) already calculates activity, attention, notices and freshness. Nothing connects the two yet. The user settled layout, cadence and rotation on 2026-09-23 before implementation:

- Layout: up to four 8-pixel rows, one per session, each with a colored state marker, a label and a state word. Rows are ordered needs attention, then working, then done. With more than four sessions, the last row shows `+N`.
- Cadence: push only when the rendered frame changes, at most once every 15 s, coalescing to the latest frame. Refresh an unchanged frame every 10 minutes.
- Rotation: a background installation in the normal rotation. Remove the installation when no session is working, waiting or holding an unacknowledged completion notice.

## What Changes

- Add a pure status view in `controllers/tidbyt`. It reads an agent-state `Snapshot` and returns at most four rows plus feed health. It shows attention as `ASK`, active work as `RUN` and an unacknowledged turn-ended notice as `DONE`. Uncertain session freshness or an unavailable feed is marked with `?` and dimmed, never shown as done or idle. Labels use the user's label, then the user's project ID, then a neutral hashed ID. They never use titles or agent content.
- Add a 3×5 bitmap font and a status frame drawer that produces the renderer's 64×32 RGB frame.
- Add a status publisher. It consumes the owner's `snapshot()` and optional change subscription, and submits writes through the existing controller queue only. It applies the 15 s minimum interval, 10 minute refresh, idle removal and failure handling. It never builds another reducer or acknowledges notices.
- Add a queued installation removal to the controller as command kind `tidbyt.remove`, raising the controller-local profile to `tidbyt-display` 1.1.0. Add `DELETE /v0/devices/{device}/installations/{installation}` to the cloud connection. #16 qualified this call.
- Record the decisions in `controllers/tidbyt/README.md`.

## Capabilities

### New Capabilities

- `tidbyt-agent-status`: status view, frame drawing and publishing from the shared agent-state feed through the Tidbyt controller queue.

### Modified Capabilities

- `tidbyt-cloud-controller`: the cloud connection gains installation removal, and the serialized queue accepts a removal write with the same identity, generation, hold and outcome rules as a push.

## Impact

Changes stay under `controllers/tidbyt` (`src`, `tests`, `package.json`, README), plus a workspace dependency on `@jimmie-potts/agent-state` in `package-lock.json` and an update to the Tidbyt section of `docs/development.md`. Existing Tidbyt CI steps run the new tests through their test glob. The shared controller v1 contract, agent-state package and hub are unchanged. No device, account, hook, service or installation is touched. Installed wiring to the hub feed and the visible acceptance stay in [#21](https://github.com/jimmie-potts/agent-device-hub/issues/21).
