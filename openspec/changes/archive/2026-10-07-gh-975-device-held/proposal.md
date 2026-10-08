## Why

[Hub #975](https://github.com/jimmie-potts/agent-device-hub/issues/975), part of [epic #827](https://github.com/jimmie-potts/agent-device-hub/issues/827): a device module holds a device after a write that may have reached it but went unanswered. [ADR 0012](../../../docs/decisions/0012-bunny-event-platform.md) ("Errors, effects and outcomes") never retries that write, and the device takes no further write until a person or a later definitive outcome resolves it. `device/2.0` has no field for the hold. The Nanoleaf module (#844, PR #968) shows a hold as `availability: degraded`, and as `held: true` only in its own `nanoleaf-wall` view, so a consumer of `device` cannot tell a held device from one degraded for another reason. The dashboard (#922) and the inbox (#923) need the hold in the shared record to show it and point a person at the operation to resolve.

## What Changes

- **`device/2.1`.** A minor version of the `device` family adds one optional member, `held: {requestId, heldAtMs}`. It is present while the module holds the device and absent otherwise. `requestId` names the operation whose uncertain write holds the device, so the tracker (#782) and the operation's inbox item (#923) can point at it; `heldAtMs` is when the hold began. The validator refuses a hold that starts after the message time and a held device that is `available`. `device/2.0` stays registered and unchanged, so records without `held` stay valid, and a `device/2.0` record that carries `held` is refused.
- **Nanoleaf.** The module publishes `device/2.1`. Its record carries `held` with the held write's request ID and the time the hold began, alongside its `degraded` availability and the wall view's `held: true`. The record drops `held` once an explicit mode command or a fresh control releases the hold. The control journal records the held operation with the hold, so a restart keeps it.
- **Docs.** The package README and MAPPING.md say what `held` means and how it clears; the Nanoleaf README describes the record's `held`.
- **Other modules.** LIFX, playback, Pixoo and Tidbyt hold no device after an uncertain write. They keep publishing `device/2.0`.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `bunny-message-profile`: the device state family gains its 2.1 version with the optional `held` member and its checks.
- `nanoleaf-module`: the device record is `device/2.1` and carries `held` while a hold stops the device's writes.

## Impact

- **Code:** `packages/event-contracts` (`schemas/v2/families/device.2.1.schema.json`, `src/v2/devices.ts`, `src/v2/registry.ts`); `modules/nanoleaf` (`src/journal.ts`, `src/controls.ts`, `src/worker.ts`, `src/module/views.ts`, `src/module/runtime.ts`).
- **Tests:** `packages/event-contracts` (`fixtures/v2/devices.json`, `tests/devices.test.mjs`); `modules/nanoleaf` (`journal.test.ts`, `module-faults.test.ts`, the test support that reads device records by version, and the port's direct holds); the runtime's `nanoleaf-wall` catalog scenario, and the scenario harness's reader, which takes any version of a family (`tests/scenarios/parts.ts`).
- **Docs:** the event-contracts README and MAPPING.md (the `device` rows only), the Nanoleaf README and PORTING.md, and the runtime README's catalog entry.
- **Unchanged:** the SDK, the runtime host, the other modules, the package version and its exact pins (the private source package keeps 1.0.0, as when #918 added the device families), coordinator-owned files and the released 1.x contracts.
- **Delivery:** source-only.
