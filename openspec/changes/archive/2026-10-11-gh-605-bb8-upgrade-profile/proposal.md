## Why

[#605](https://github.com/jimmie-potts/agent-device-hub/issues/605) needs the established runtime to admit configured BB-8 and preserve its private state during compatible recovery. The current procedure deliberately refuses configured or retained BB-8; accepted generic runtime qualification cannot satisfy that gate.

## What Changes

- Qualify BB-8's production SQLite state, responsibility and SDK outbox through disposable latest-state recovery and re-upgrade, with no command replay.
- Qualify the separate Windows receipt store and enrollment binding without WSL opening Windows databases or using radio.
- Include the Windows helper's storage-bearing source in conservative format evidence, and admit configured/retained BB-8 only under complete coordinator-bound compatibility evidence.
- Preserve the separately coordinated absent-ONN boundary, other module protections, private evidence and distinct installation/physical acceptance.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `bunny-runtime-upgrades`: configured and retained BB-8 coverage, helper-format evidence and compatible no-replay recovery.

## Impact

Runtime source classification, state/health admission, owning upgrade instructions and existing runtime/BB-8 tests. No public device command, schema, motion control, root dependency, camera driver or service activation changes. Preserve the accepted absent-ONN profile during integration. Independent reviews, hosted CI and guarded merge remain required after source preparation; installed BB-8 and physical tests remain #605's subsequent gates.
