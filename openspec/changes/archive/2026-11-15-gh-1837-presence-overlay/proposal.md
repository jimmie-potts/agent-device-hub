## Why

[#1837](https://github.com/jimmie-potts/agent-device-hub/issues/1837) needs a useful
apartment view of the stock reports delivered by #1841. Room occupancy and
approximate anonymous points are useful before physical accuracy is qualified.

## What Changes

- Follow Presence Pro observations through the existing authenticated dashboard SDK connection.
- Highlight reported room occupancy and show anonymous approximate apartment points with receipt and hold evidence.
- Make source loss and stale SDK copies unknown while retaining clearly dated last-known text.
- Preserve apartment content, fixture controls, no-sensor operation and rendering fallback.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `room-models`: add truthful device-reported anonymous presence to apartment inspection.

## Impact

Runtime dashboard feed, apartment presentation and existing synthetic unit/browser
checks. The browser imports the public `@jimmie-potts/presence-pro/contracts`
contract; acquisition, calibration and private configuration remain producer-owned.
No geometry/schema changes, device commands, identity inference or installation.
The separately owned #1842 pilot checks physical usefulness.
