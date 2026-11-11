## Why

The core's history is append-only, private and kept without a time limit, but its rows name no installation and are ordered only by a counter local to one store ([#1723](https://github.com/jimmie-potts/agent-device-hub/issues/1723)'s store audit). The owner decided on [#1729](https://github.com/jimmie-potts/agent-device-hub/issues/1729) that history becomes a fact log (option B), and the prototype there showed that two stores with different origins can read each other's rows after a cursor and merge them as a union. [#1740](https://github.com/jimmie-potts/agent-device-hub/issues/1740) is the first story: every row names its origin and its place in that origin's order, and a reader can ask for everything after a point. The decision maker ([#1728](https://github.com/jimmie-potts/agent-device-hub/issues/1728)) reads it, and the two-machine work merges it later.

## What Changes

- **An origin for the installation.** The core store creates a random UUID once, in the transaction that opens history, and keeps it in a new one-row table `core_origin`. It needs no configuration, is never derived from a host name, user name, address or path, and two installations never share one.
- **`origin` and `origin_seq` on every history row.** A new row takes this origin and the next sequence of that origin, from 1, with no gaps. A store written before this change gains both columns and every existing row takes this origin and a sequence in `seq` order, the order the rows were written, in one transaction. Opening a migrated store again changes nothing. The store keeps its existing mechanism: tables created if absent, and a column added when `PRAGMA table_info` lacks it.
- **Read after N inside the core.** `History.after(origin, afterSeq, limit)` returns that origin's rows after `afterSeq`, oldest first, at most 500 a call. The reader keeps its own cursor; the core stores no reader position. An unknown origin returns nothing. Reading writes nothing and publishes nothing.
- **The duplicate check looks only at the local origin's rows.** The `(source, message_id)` unique index becomes `(origin, source, message_id)`, so a fact another origin also holds never makes the local tracker treat its own copy as a duplicate.
- **Unchanged:** the message envelope and every message contract, the existing filtered history read and its gateway and MCP routes, the staleness check on live intake (`core_history_latest`), and what history keeps.
- **Not built here:** reading another installation's facts over the network, merging them, new kinds of fact (#1731), a gateway or MCP route for the read, and anything in the decision maker or the orchestrator.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `bunny-runtime`: core history rows carry an origin and a per-origin sequence, a store written before this migrates exactly, and the core reads one origin's rows after a sequence.

## Impact

- `apps/runtime/src/core/history.ts`: the origin, the columns and their migration, `after`, and the origin-limited duplicate check.
- `apps/runtime/tests/history-fact-log.test.ts`: migration of a store as the previous release writes it, the origin, read after N, the duplicate check and a read that writes nothing.
- `apps/runtime/README.md` and `apps/runtime/UPGRADE.md`: the origin, read after N and the storage change.
- **Storage migration** of the installed core store (`core.sqlite`): forward-only, one transaction at first open. ADR 0012's amendment recording the owner's 2026-11-11 decisions is [#1739](https://github.com/jimmie-potts/agent-device-hub/issues/1739). Delivery is source-only; installation follows the runtime upgrade procedure separately.
