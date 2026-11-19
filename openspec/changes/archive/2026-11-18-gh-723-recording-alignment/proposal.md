## Why

Saved decorative shows start at zero and run on their own clock. [#723](https://github.com/jimmie-potts/agent-device-hub/issues/723) adds measured shows that start at the observed position of the associated item in the configured Mac Music library and remain safe when playback changes.

## What Changes

- Save immutable measured show versions with scoped Music library item identity, analysis provenance, and authored cue timing. Preserve the existing decorative versions and start behavior.
- Check the Music library scope and item and fresh playback position before starting a measured show. Explain when the item or position cannot be verified.
- Follow the verified playback position with the existing timeline worker. Handle pause, seek, track changes, output changes, and source loss without sending cues scheduled for an obsolete position.
- Exercise alignment with generated audio or synthetic evidence. Functional installation and physical trials belong to #725. Optional speaker-delay calibration belongs to #1910.

## Capabilities

### Modified Capabilities

- `nanoleaf-show-library` stores and previews measured versions alongside decorative versions.
- `runtime-playback` supplies the position and discontinuity evidence used to align a measured show.
- `music-lighting-session` admits a measured show under the existing explicit per-light controls and ends it when its playback evidence is lost.
- `nanoleaf-music-timeline` uses qualified transport position for measured shows.

## Impact

The native Music producer and playback owner supply evidence. The core admits sessions through the existing SDK controls. The Nanoleaf module retains show storage and the device workers. The Audio page exposes the measured-show controls and safe refusal status. Existing device ownership, playback controls, and private storage boundaries apply.
