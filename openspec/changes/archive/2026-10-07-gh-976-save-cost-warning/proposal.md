## Why

PR #974's performance review ([#972](https://github.com/jimmie-potts/agent-device-hub/issues/972)) found that each save of
the runtime core rewrites agent-state's whole state block, which grows with its 24-hour change journal and each session's
guards: 182 KB after 500 observations and 707 KB after 3,000. Every save also clones, validates and serializes the whole
state. At desk use a save costs milliseconds, and the 16 MiB limit already refuses growth past it. The owner decided
(2026-10-07) to add a cheap early warning and take one reading on the real install, and to build the larger fixes only if
either shows real cost. [Hub #976](https://github.com/jimmie-potts/agent-device-hub/issues/976) item 1 is that warning;
item 2, the reading after the cutover, waits for #840 and is not part of this change.

## What Changes

- **One warning.** The core store measures each save that commits: agent-state's commit through the store's lease, from
  applying the change to the last committed state to the transaction's `COMMIT`. It logs `storage.cost.high` at WARN
  once the state block passes half of the 16 MiB limit, or once one save takes longer than 100 ms, once per run of the
  condition, and `storage.cost.normal` at INFO once a save is back within it. A record carries the block's size in bytes
  or the save's time, never the state's content. A logger that throws never changes a save.
- **Profile 1.5.** The diagnostic contract registers the two module events and the attributes `bunny.state.bytes` and
  `bunny.save.duration_ms` in a new profile, artifact 1.5.0, and the runtime writes its records at profile 1.5. The SDK
  kit's record check follows the runtime to profile 1.5.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `shared-observability-contract`: profile 1.5 registers a store's costly saves, and the artifact is 1.5.0.
- `bunny-runtime`: the runtime's records are profile 1.5, and the core store records a costly save.

## Impact

- **Code:** `apps/runtime/src/core/store.ts` (`SAVE_COST`, the save's measurement and its records) and
  `apps/runtime/src/record.ts` (profile 1.5); the observability package's catalog, schema, fixtures, helpers and tests;
  the SDK kit's record check.
- **Version pins:** `@jimmie-potts/bunny-observability` 1.5.0 in `apps/hub`, `apps/maintenance`, `apps/runtime` and
  `packages/sdk`, the lockfile and the packaging scripts.
- **Unchanged:** the 16 MiB limit and its `state-capacity` refusal, session history and its scope (#782, #282), and
  logging and diagnostic retention (#777, #810). No message, API or stored format changes.
- **Delivery:** source-only for the warning; it is installed with the runtime at the cutover (#840), after which #976's
  reading is posted on #123.
