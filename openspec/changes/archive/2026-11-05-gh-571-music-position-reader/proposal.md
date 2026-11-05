## Why

[#571](https://github.com/jimmie-potts/agent-device-hub/issues/571) needs trustworthy Music.app state and position observations. The bounded native probe in [#41](https://github.com/jimmie-potts/agent-device-hub/issues/41#issuecomment-6650267619) established basic read access; this source increment turns that path into a supervised, testable local component.

## What Changes

- Add a separate native Music position helper with explicit invocation, nonprompting read-only AppleEvents, pinned process identity and independent state/position read intervals.
- Add a TypeScript one-cycle supervisor with closed parsing, a whole-child deadline, cancellation, partial-result handling and generation fencing.
- Extend the existing music native build and fake-adapter checks; add portable parser and real synthetic child-pipe acceptance.
- Retain the full issue. This increment adds no automatic polling, SDK publication or grant, playback selection, transport control, metadata/output collection, installation or physical qualification.

## Capabilities

### New Capabilities
- `music-position-reader`: Explicit bounded local reads of an already-running Music application's state and position.

### Modified Capabilities
None. The capture helper and runtime playback contracts retain their existing behavior.

## Impact

Source is confined to `apps/music-producer`, its owning guides and this issue-linked OpenSpec change. The new helper has a distinct identity and local IPC schema; it links AppKit/CoreServices and does not link capture code. Existing app TypeScript and macOS synthetic checks cover it. ADR 0012's registry supplies failures; no event-platform or cross-repository contract changes are introduced. Future playback integration remains owned by `modules/playback` and #571.
