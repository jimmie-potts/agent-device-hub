## Why

Pixoo currently refuses exact artwork in a moment. [#1288](https://github.com/jimmie-potts/agent-device-hub/issues/1288) consumes the accepted [art handoff](https://github.com/jimmie-potts/agent-device-hub/blob/main/docs/art-generation-qualification.md) so a validated composition can play through the existing display writer without entering the permanent library. The [2026-11-05 owner amendment](https://github.com/jimmie-potts/agent-device-hub/issues/1288#issuecomment-6650127516) also permits brief scheduled exact art over empty Media.

## What Changes

- Admit core-forwarded `art-stage/2.0` commands into bounded private media, preserving original bytes and immutable renditions.
- Keep composition references private, reuse identical stages, reject conflicting or invalid stages and expire unused copies safely.
- Serve authenticated previews and play exact artwork through `moment-play/2.1`, including admitted GIF frame timing.
- Preserve current moment admission, attention, manual control, uncertainty and restoration rules.
- Permit exact art over idle, stopped Media with no selection, preserving pauses across restart, selected content and core pin arbitration; view changes cancel waiting art or interrupt playing art.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `bunny-pixoo-module`: private generated-art admission, preview, retention and exact-art moments.

## Impact

The Pixoo module, media adapter and presentation/player path change. Existing shared `art-stage/2.0` and `moment-play/2.1` contracts are consumed unchanged. Source and disposable simulated evidence belong here; installation and physical acceptance remain in [#687](https://github.com/jimmie-potts/agent-device-hub/issues/687).
