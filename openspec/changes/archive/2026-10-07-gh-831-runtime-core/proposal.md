## Why

[Hub #831](https://github.com/jimmie-potts/agent-device-hub/issues/831), part of
[epic #827](https://github.com/jimmie-potts/agent-device-hub/issues/827), makes the new runtime the one owner of agent
sessions. Until now a test stand-in played the session owner, so no device module could build on real session state,
and #842's root session fixtures were valid one by one but no owner could have produced them in one history. ADR 0012
requires each core change and the messages it publishes to commit in one SQLite transaction, a full disk to refuse
durable work before anything reports it accepted, and a publication refused after a commit to stand as committed and
awaiting publication.

## What Changes

- **The core** (`apps/runtime/src/core`), the module `core` with the source `bunny/core`, first in the shipped module
  list. It runs `@jimmie-potts/agent-state`'s owner, imported unchanged, takes hooks' 2.0 `lifecycle` observations into
  the reducer once by `(source, id)`, publishes each committed change as `session` state, removal and occurrence
  messages, serves `session` through sync with freshness revisions, and answers `notice-acknowledge`. A core failure
  ends the runtime with `core-failed`.
- **The core store**, copied from the old Hub's `apps/hub/src/storage.ts` with provenance notes. It keeps the Hub's
  `state` format and lease, and adds the outbox, published records, history and taken `(source, id)` rows in each
  change's own transaction. A part, the extension point for #782 and #923, adds tables, sync families, derived rows
  and its own intake.
- **Decisions MAPPING.md left to this story:** what an owner-started clearing carries as its observation (the session's
  current turn, the owner's instant, unknown ordering), that an acknowledgment publishes no outcome, and that a consumer
  acknowledges for itself only (`forbidden` otherwise).
- **Tests and fixtures:** store, core and process tests, including a full disk, a refused publication, a kill between
  commit and publish, a duplicate after a restart and the lease; the module test kit on the core; a new catalog
  scenario, `agent-sessions`; the fixture core becomes the real core with stand-in parts for history, the inbox and the
  mode; and #842's root session fixtures regenerated from a reference history the real owner replays.
- **Docs:** the runtime README, the verification adapter's README, MAPPING.md, the event contracts README,
  docs/app-verification.md and docs/architecture.md, whose host session ID now persists in the core's private store.

## Capabilities

### New Capabilities
None.

### Modified Capabilities
- `bunny-runtime`: new requirements for the agent-session core, its store's transactions and failures, and its
  extension point; the shipped list, the module context's source, failure isolation, the fixture core, the scenario
  catalog and the SDK edge's wording change with them.
- `bunny-message-profile`: notice acknowledgment's replies and rule, and what an owner-started clearing carries.

## Impact

- **Source:** `apps/runtime/src/core/*` (new), `apps/runtime/src/host.ts`, `runtime.ts`, `process.ts`, `modules.ts`
  and `index.ts`; `apps/runtime/verify/plugin.ts` watches and serves the agent-state and lifecycle-contracts builds the
  run now loads.
- **Manifests:** `apps/runtime/package.json` adds `@jimmie-potts/agent-state` 3.6.0; `package-lock.json` gains that
  one line.
- **Fixtures:** `packages/event-contracts/fixtures/v2/families.json`'s root session messages, the notice they name, and
  one invalid case's generation.
- **Behavior:** source-only. The shipped runtime now hosts the core; nothing is installed until the cutover (#840),
  where sessions start fresh.
