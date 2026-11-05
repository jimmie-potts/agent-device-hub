## Why

The existing Nanoleaf animation command refuses NL22 Light Panels even though
their geometry, display encoder and per-device writer already exist. The owner
wants the same requested animations on the Panels as a prerequisite for music
lighting. [Issue #1258](https://github.com/jimmie-potts/agent-device-hub/issues/1258)

## What changes

- Render preset, explicit and saved-favorite recipes against the selected
  device's saved geometry, using one zone per NL22 triangle.
- Admit requested animations for a configured Panels device in Free and send
  them through that device's existing journal and worker.
- Publish animation options for each configured device, including its mode,
  queued request, geometry availability and remembered scene.
- Validate device isolation, queue bounds, cancellation and uncertain outcomes
  with simulated controllers.

## Capabilities

### New capabilities

### Modified capabilities

- `nanoleaf-module` gains requested animation playback and animation state for
  Panels under its existing message families.

## Impact

The change affects `modules/nanoleaf`, its guide, its existing capability
specification and focused runtime consumer tests. It reuses the profile 2.0 module commands and the device's display
2.0 payload. The shared favorites catalog remains the source of frozen recipes,
edited through its existing Lines command. The delivery is source and disposable
acceptance under #1258. Installed music-lighting qualification belongs to
[#725](https://github.com/jimmie-potts/agent-device-hub/issues/725).
