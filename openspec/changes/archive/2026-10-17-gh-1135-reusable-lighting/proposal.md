## Why

The approved lighting design needs one reusable implementation instead of separate cards for Home, brands and rooms. The current runtime offers general device controls but has no saved lighting composition or room assignments. Owning issue: https://github.com/jimmie-potts/agent-device-hub/issues/1135.

## What Changes

- Add a reusable glass lighting card with persistent artwork and accessible, animated Power, Color, Scenes and Timer control tabs.
- Reuse existing SDK records and guarded tracked commands on Home, brand and room views; preserve detailed routes and advanced editors.
- Add a private core-owned lighting layout, saved through one revision-guarded command, for rooms, assignments, Home selections and per-view custom groups.
- Support drag and explicit menu grouping without device effects; room cards resolve their current members rather than copying a device list.
- Respect actual device capabilities, native modes, unavailable members and uncertain operations. Explain unimplemented scene/timer services rather than running prototype behavior as a live feature.

## Capabilities

### New Capabilities

- `runtime-lighting`: reusable lighting presentation, room/brand/Home composition and guarded shared controls.

### Modified Capabilities

- `shared-event-contract`: bounded lighting-layout state and revision-guarded metadata command under profile 2.0.

## Impact

Changes affect the event contract registry and schemas, the runtime core part and its private store, the existing dashboard feed and routes, reusable React controls and owning verification scenarios. Existing device owners, LAN transports, module policies and single-device advanced pages remain authoritative. No external package, host, physical device test or general widget-grid editor is selected.
