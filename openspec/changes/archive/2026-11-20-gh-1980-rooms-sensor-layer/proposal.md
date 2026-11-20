## Why

Rooms needs a quiet default apartment view and a way to see which Presence Pro
tracks each part of a shared room. [Issue #1980](https://github.com/jimmie-potts/agent-device-hub/issues/1980)
requests two named floor zones and an optional sensor layer.

## What Changes

- Add a Sensors toggle to the 3D map. The open layer offers Pro 1, Pro 2 and Both.
- Show Couch and Kitchen work area footprints with point-based tracking cues.
  Draw and revise each footprint in an explicit overhead editing mode.
- Save the owner-drawn footprints in the browser, scoped to the prepared model.

## Capabilities

### Modified Capabilities

- `room-models` gains optional sensor presentation and private floor-zone editing.

## Impact

The dashboard consumes the existing Presence Pro observations and apartment
geometry. [Issue #1842](https://github.com/jimmie-potts/agent-device-hub/issues/1842)
continues to own physical calibration and coverage. The two reports retain their
own sensor, slot, room and receipt evidence.
