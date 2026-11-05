## Why

The closed `moment-play/2.0` schema carries a mood and a palette, not an image, and a module imports only the SDK and the contracts, so `modules/art` has no way to give a display an exact artwork. [The qualification record](../../../../docs/art-generation-qualification.md#exact-artwork-handoff) selects the handoff, and [Hub #679](https://github.com/jimmie-potts/agent-device-hub/issues/679) owns its contracts and core forwarding. The owner decisions of 2026-11-03 on epic #677 make automatic art routine background work.

## What Changes

- Five command families in `@jimmie-potts/event-contracts/v2/art`: `art-request`, `art-auto`, `art-dispatch`, `art-stage` and `art-ambient-set`, with helpers for a device's private copy.
- `moment-play/2.1`, with an optional `art: {compositionId}`, and `device/2.2`, with an optional `capabilities.moments.art`. `commandSupported` refuses a moment with `art` for a device that does not declare it. `moment-play/2.0`, `device/2.0` and `device/2.1` keep their behavior.
- A core part forwards `art-dispatch` from `bunny/modules/art` only, as tracked `art-stage` and `art-ambient-set`, and never as `moment-play`.
- Tracker checks on `requestedBy` for the four tracked art families, and gateway refusals for `art-auto`, `art-dispatch`, `art-stage` and `art-ambient-set`.
- The omitted-payload path generalizes from ONN text to `art-stage`: bytes reach the responder and stay out of the stored operation and history, and duplicates are still detected.
- An inbox exemption for `art-auto`, `art-stage` and `art-ambient-set`, recorded in an ADR 0012 amendment.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `bunny-message-profile`: the art families, `moment-play/2.1` and `device/2.2`.
- `bunny-runtime`: art forwarding, requester checks, gateway refusals and omitted art bytes.
- `shared-inbox-history`: routine art raises no item, and a resend of any omitted payload is refused.

## Impact

- **Code:** `packages/event-contracts` (`src/v2/art.ts`, `devices.ts`, `families.ts`, schemas, fixtures, README, MAPPING), `apps/runtime/src/core` (`art-part.ts`, `core.ts`, `tracker.ts`, `operations.ts`, `inbox.ts`) and `apps/runtime/src/gateway/gateway.ts`.
- **Storage:** no schema change. Stage operations use the existing `payload` marker and the private digest key.
- **Delivery:** source only. `modules/art`, device responders, the `art` state record and the Show dispatch belong to #680, #1288, #681 and #684. Installed and physical acceptance belong to #687.
