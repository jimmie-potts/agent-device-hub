## Why

[Issue #623](https://github.com/jimmie-potts/agent-device-hub/issues/623) needs useful MicroDuck controls and coding status expression before hardware arrives. The accepted [#620 definition](https://github.com/jimmie-potts/agent-device-hub/issues/620) qualifies the real upstream simulator and defines its persistent-input and stopping limits.

## What Changes

- Ship a TypeScript MicroDuck module with a finite head-only catalog, private responsibility/outbox, strict profile 2.0 families and device/2.1 status.
- Admit only an owned, witnessed Linux simulator pair. Bound JSON-RPC, sensor freshness, scheduling and process supervision; never reconnect or replay motion after session loss.
- Add tracked dashboard gestures, local Stop expression, takeover, explicit held recovery and opt-in first-live coding reactions. Expose cached status only through MCP.
- Add deterministic failure coverage, both SDK transport scenarios, browser/accessibility checks and actual pinned vendor acceptance.

## Capabilities

### New Capabilities

- `bunny-microduck`: Simulator admission, finite head expression, local cancellation, fresh-state recovery, durable outcomes and operator controls.

### Modified Capabilities

None. Reuse existing SDK/core/companion ownership and envelopes without changing their guarantees.

## Impact

New `modules/microduck`, module-owned frontend and fixture supervisor. Add the internal MicroDuck core dispatch family and allowlisted routing, runtime/scenario consumers, root workspace/build/check scripts and CI selection. Reuse SDK, event contracts, SQLite and Node built-ins; no new vendor library or redistributed model/policy assets. Installation and physical qualification remain #624; walking remains blocked on its stopping evidence. No household runtime, capture, audio or hardware operation is included.
