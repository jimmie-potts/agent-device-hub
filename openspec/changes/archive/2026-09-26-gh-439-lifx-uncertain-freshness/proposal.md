## Why

#20 decided that the LIFX status publisher paints nothing while any shown root session has `uncertain` freshness. In agent-state, a session becomes uncertain after five minutes without new evidence, and a restored session stays uncertain until its next event. A finished turn waiting to be read is idle by nature, so it is nearly always uncertain. The #22 installed trial on 2026-09-26 found 15 of 16 shown root sessions uncertain and `highestStatus` stuck at `unknown`, so a bulb in Work or Quiet would stay unpainted for up to the 24-hour evidence expiry. Issue: https://github.com/jimmie-potts/agent-device-hub/issues/439.

## What Changes

- `highestStatus` ranks every shown root session by the state the shared owner reports, whatever its freshness, and returns `unknown` only for an unavailable feed or a collector that is not running. The owner chose this on 2026-09-26.
- The LIFX status publisher therefore paints the reported highest state on transitions even when sessions are uncertain.
- The Tidbyt's per-row uncertainty marker and all other #20 rules are unchanged.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `local-controller-host`: the automatic LIFX status painting requirement states how session freshness and feed health affect painting.

## Impact

`packages/agent-status/src/status.ts` and its tests, `controllers/lifx/tests/status-publisher.test.mjs`, `controllers/lifx/README.md` and `docs/development.md`. No wire, configuration or dashboard change. Installing the new host release and resuming the physical check belong to #22.
