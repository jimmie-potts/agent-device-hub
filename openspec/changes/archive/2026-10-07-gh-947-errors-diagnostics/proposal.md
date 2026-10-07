## Why

[Hub #947](https://github.com/jimmie-potts/agent-device-hub/issues/947), part of [epic #827](https://github.com/jimmie-potts/agent-device-hub/issues/827): before more modules build on the runtime, [ADR 0012](../../../../docs/decisions/0012-bunny-event-platform.md) states one contract for errors, effects, logs and traces. Its 2026-10-07 amendment also corrects a contradiction. The ADR and the `bunny-runtime` "Failure isolation" requirement list a device timeout among module failures, but the owner's module failure policy A of 2026-10-06 ([#919](https://github.com/jimmie-potts/agent-device-hub/issues/919)) makes device errors and timeouts outcomes and device state, never a module failure.

## What Changes

- "Failure isolation" no longer calls a device timeout a module failure. A module handles its device's errors and timeouts itself, as outcomes and device state. An error that escapes the module still stops only that module, which stays `failed` until the runtime restarts.
- Two scenarios keep their tested behavior with policy A's wording: a start that never finishes waits on something that never answers, and a scheduled callback's device `TimeoutError` stops the module only because the module did not handle it.
- The runtime's behavior and tests do not change. Policy A's module-side checks belong to #919's kit work.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `bunny-runtime`: the "Failure isolation" requirement's wording and two scenarios' conditions.

## Impact

- **Docs:** ADR 0012 (a new "Errors, effects and outcomes" section, a rewritten "Observability", the failure-isolation bullet, `accepted`, `tracestate` and a dated amendment), the runtime README's "Failure isolation" and the AGENTS.md route to ADR 0012.
- **Code:** none. The SDK changes the amendment requires are #948, and the new instrumentation is #949.
- **Delivery:** source-only; documentation and specification.

**No design.md.** ADR 0012's 2026-10-07 amendment is the design record: it states each decision and its trade-off. This change rewords one requirement to match that record and changes no runtime, storage, migration, timing or privacy behavior.
