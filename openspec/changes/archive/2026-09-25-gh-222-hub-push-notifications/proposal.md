## Why

[Hub #222](https://github.com/jimmie-potts/agent-device-hub/issues/222): `GET /api/monitor/v1/changes` runs one 1-second timer per open stream. A committed revision reaches a reader 0 to 1 second later, and the first stream whose timer fires also advances the shared feed state for every stream. The agent-state core already signals every commit with `feeds.publish(revision)`, but the hub does not listen; `owner.subscribe` does not fit because it needs a registered consumer ID and durable consumer configuration, which a hub reader has neither.

## What Changes

- The agent-state owner exposes `onCommit(callback)`: a listener that fires synchronously after every committed revision, from any admission path, with no consumer ID or cursor. A throwing listener is caught inside the core and never faults the collector or the triggering call's outcome.
- The hub's `/api/monitor/v1/changes` route registers one `onCommit` listener at startup. A notification schedules the shared fan-out with `setImmediate`, outside the commit call, so a burst of commits produces at most one flush per open stream. The existing 1-second timer remains, now shared instead of per-stream, for heartbeats and the per-stream auth recheck, and for changes that do not commit (collector state, quiesce, loss count, rejected admissions, sessions turning uncertain). Its interval is overridable only through a test-only `feedIntervalMs` hub option, kept out of the configuration file `cli.ts` validates.
- Wire format, limits and semantics are otherwise unchanged: event IDs, the 32-entry replay window, resync on an unknown cursor, the 16-stream cap and disconnecting a reader stalled more than 5 seconds. Bursts now produce more events per second of history, so a reconnecting reader can see `resync` more often; both current clients already refetch the snapshot on `resync`.
- Publish agent-state 3.1.0 and Hub 0.3.1.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `agent-state-core`: a commit-notification listener that needs no registered consumer, isolated from the commit path it observes.
- `standalone-hub-host`: the shared `/changes` transport pushes on commit instead of relying only on its periodic timer.

## Impact

`packages/agent-state/src/subscriptions.ts` and `src/index.ts` (the new listener), `apps/hub/src/server.ts` (shared fan-out replacing the per-stream timer), their tests, the agent-state and Hub guides, and both package manifests. `controllers/tidbyt` only takes the exact-pinned dependency bump; it does not read commit notifications. Nanoleaf can later replace its once-a-second poll with this stream ([codex-nanoleaf#90](https://github.com/jimmie-potts/codex-nanoleaf/issues/90)), which this issue blocks. Tidbyt's 30-second poll is unaffected: its writes are at least 15 seconds apart, so earlier notice does not help it.
