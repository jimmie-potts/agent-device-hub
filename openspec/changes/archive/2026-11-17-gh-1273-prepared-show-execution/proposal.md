## Why

The saved show library can validate and preview cue timelines, and the Nanoleaf workers can run live Music sessions. [#1273](https://github.com/jimmie-potts/agent-device-hub/issues/1273) connects the two so each light can play an immutable saved revision on a bounded schedule.

## What changes

- Admit a saved decorative show through the Music lighting owner and the existing worker for the selected Lines or NL22.
- Support explicit start, pause, resume, seek and stop. Keep scheduling evidence distinct from the command outcome and physical display.
- Apply the [#40](https://github.com/jimmie-potts/agent-device-hub/issues/40) saved-show policy. Keep Music.app clock alignment, timing profiles and UI replay with [#723](https://github.com/jimmie-potts/agent-device-hub/issues/723). Installed and physical acceptance remain with [#725](https://github.com/jimmie-potts/agent-device-hub/issues/725).

## Capabilities

### Modified capabilities

- `nanoleaf-music-timeline`: Add bounded worker execution and explicit transport operations for saved timelines.
- `bunny-runtime`: Extend tracked Music lighting dispatch to authorize prepared sessions and transport controls.

## Impact

The runtime core, profile 2.0 Music lighting families, Nanoleaf show reader and the existing per-light worker and journal change. The saved show schema and existing live Music requests remain compatible. No new installation or physical-device operation is part of this change.
