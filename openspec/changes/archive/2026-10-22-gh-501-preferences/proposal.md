## Why

[#501](https://github.com/jimmie-potts/agent-device-hub/issues/501) needs an inspectable private preference library. The existing companions owner already supplies durable storage, authenticated content and tracked private input, so this can remain one bounded source feature.

## What Changes

- Add titled explicit preferences, retained edit/state history and Stop using/Reactivate controls.
- Copy selected active preferences and expose a minimal active-only private read.
- Export versioned private JSON; import missing stable IDs inactive while preserving all existing records.
- Add a dashboard page, content-free revision state, focused failure/privacy tests and a synthetic runtime/browser journey.

## Capabilities

### New Capabilities

- `bunny-preferences`: private explicit preference management and additive import.

### Modified Capabilities

None. Existing assistant tasks and Reachy behavior remain unchanged.

## Impact

`modules/companions`, the event-contract state registry, runtime scenario/browser checks and owning documentation. Reuse `assistant-input/2.0` with the distinct `preferences` target and opaque staging references; no SDK upload framework change, new dependency, service or database. Source-only; #508 owns installed acceptance. Automatic context insertion, learning and erasure are excluded.
