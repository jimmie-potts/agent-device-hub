## Why

Pixoo currently refuses exact artwork in a moment. [#1288](https://github.com/jimmie-potts/agent-device-hub/issues/1288) consumes the accepted [art handoff](../../../docs/art-generation-qualification.md) so a validated composition can play through the existing display writer without entering the permanent library.

## What Changes

- Admit core-forwarded `art-stage/2.0` commands into bounded private media, preserving original bytes and immutable renditions.
- Keep composition references private, reuse identical stages, reject conflicting or invalid stages and expire unused copies safely.
- Serve authenticated previews and play exact artwork through `moment-play/2.1`, including admitted GIF frame timing.
- Preserve current moment admission, attention, manual control, uncertainty and restoration rules.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `bunny-pixoo-module`: private generated-art admission, preview, retention and exact-art moments.

## Impact

The Pixoo module, media adapter and presentation/player path change. Existing shared `art-stage/2.0` and `moment-play/2.1` contracts are consumed unchanged. Source and disposable simulated evidence belong here; installation and physical acceptance remain in [#687](https://github.com/jimmie-potts/agent-device-hub/issues/687).
