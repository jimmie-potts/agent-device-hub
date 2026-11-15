## Why

[#1853](https://github.com/jimmie-potts/agent-device-hub/issues/1853) identifies a permanent voice lock after uncertain playback survives restart. The operator needs to release that old reservation after stopping playback, without rewriting its uncertain outcome.

## What Changes

- Add explicit recovery for an orphaned speech operation after restart, naming the operation and confirming earlier playback is stopped.
- Persist the operator acknowledgement separately from playback, atomically with the state revision. Keep voice off until a fresh enable action.
- Expose recovery in both existing voice control views. Check local synthesis is idle and require the operator to stop playback in earlier voice tabs.
- Preserve live-speaker exclusion, qualification, authentication and no automatic replay.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `bunny-companions`: explicit recovery of an orphaned uncertain speech reservation.

## Impact

Companions coordinator, private SQLite acknowledgement table, browser session and controls; minor 2.1 versions of speech endpoint and state contracts; dashboard endpoint schema selection. Existing 2.0 contracts remain registered. No external repository contract, synthesis provider or host configuration changes. Source acceptance uses synthetic audio; installed verification uses the existing qualified Mac route.
