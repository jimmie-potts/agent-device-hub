## Why

The owner wants private usage history for the enrolled VOLCANO HYBRID when using its physical buttons, without any B.U.N.N.Y. control command ([Hub #615](https://github.com/jimmie-potts/agent-device-hub/issues/615), epic [#756](https://github.com/jimmie-potts/agent-device-hub/issues/756)). The [#614 live trial](https://github.com/jimmie-potts/agent-device-hub/issues/614) of 2026-11-03 settled what the device reports and how, and left only the versioned observation payload for this change to name.

## What Changes

- A `volcano-observation/2.0` occurrence family, naming #614 AC2's versioned payload.
- The `ingest` scope gains that family and its key, bound on every entry to the feed's derived collector credential. History does not keep the raw observation.
- A fixed shipped `modules/volcano`: private facts in its own SQLite store, read-time sessions, device and `volcano-status/2.0` state, fixed authenticated reads, a `status` MCP tool and one tracked command, the session gap threshold, which never reaches a device.
- A host-local collector, `apps/runtime/src/collector/volcano.ts` and `bin/volcano-collector.mjs`, over a transport with no write method and a fixed read and notify allowlist.
- A non-workspace `apps/volcano-collector` package holding the pinned `@stoprocent/noble` binding, so the root lockfile and container image gain no native dependency.

The card is #616. Installation, the macOS launch path and physical acceptance are #617.

## Capabilities

### New Capabilities

- `volcano-history`: the Volcano module's facts, sessions, state, reads and threshold, and the collector's read-only observation path.

### Modified Capabilities

- `shared-event-contract`: the `volcano-observation` family.
- `bunny-runtime`: the `ingest` scope's new family and its source binding; history leaves the raw observation out.

## Impact

- **Code:** `packages/event-contracts`, `apps/runtime/src/gateway`, `apps/runtime/src/core/history.ts`, `apps/runtime/src/collector`, `apps/runtime/bin`, `modules/volcano`, `apps/volcano-collector`. The Codex collector's publication failure reporting moves unchanged into a shared `collector/publication.ts`.
- **Storage:** a new private `volcano.sqlite`, created when the module is first configured. It exists on no installed host until #617. The upgrade inventory and preflight learn the owner, and an unconfigured Volcano reports the same absent-module refusal as Wemo.
- **Contracts:** additive. Controller 1.x kinds, lifecycle and session state are untouched.
- **Checks:** `test:volcano`, `test:volcano:built`, `test:volcano:consumer:built`, a CI step in each of the modules and runtime groups, and a CI selection rule.
- **Docs:** `modules/volcano/README.md`, `apps/volcano-collector/README.md`, `apps/runtime/README.md`, `docs/development.md`, `docs/architecture.md`, the contract README and mapping.
