## Why

[Hub #1836](https://github.com/jimmie-potts/agent-device-hub/issues/1836) gives the owner one place to inspect the furnished apartment and find its assigned lights. The current prepared model shows one room at a time and cannot represent shared coordinates or private artwork.

## What changes

- Add a prepared apartment model with calibrated room geometry, aligned room scan refinements, placed furnishings, artwork and explicitly bound fixtures.
- Add offline publication with private assets, the core state lease and previous-version retention.
- Show the apartment in Rooms with one 3D design, orbit, zoom, an overhead camera and cutaway. Use the existing device evidence and guarded individual LightCards.

## Capabilities

### New capabilities

None.

### Modified capabilities

- `room-models` adds apartment preparation, authenticated artwork reads and whole-apartment inspection alongside existing room-model/1.0 data.

## Impact

The runtime core owns the prepared model and assets. The dashboard reads them through the existing authenticated SDK content API. Original captures and installed acceptance belong to the private deployment handoff. Source checks use synthetic data.
