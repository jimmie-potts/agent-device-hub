## Context

See proposal.md for motivation. The hub previously held command tickets in a map of per-principal ledgers plus a shared bounded replay list, inline in `startHub`. Browser sessions were a separate map keyed by token digest. Logout and replacement destroyed streams by principal ID. Nothing connected session removal to ledger or replay cleanup. A monitor read calls the ticket accessor, which created a ledger on demand for any principal, including one retired while its request was in flight. The design is required because the change affects authorization, replay, stream lifetimes and asynchronous settlement.

## Goals / Non-Goals

**Goals:** one owner for tickets and replay accounting; one idempotent browser retirement path; admission re-checks across awaits; unchanged limits and wire behavior.

**Non-Goals:** a persistent session store or service, changes to controller command replay, cancelling or retrying admitted work, quiescing agent state, changing device writers, memory profiling (Hub #123), and multi-operator or remote sessions.

## Decisions

1. **Replay ledgers own tickets and replay accounting (`apps/hub/src/replay.ts`).** The module keeps the existing ledger map and FIFO replay list with the same 256-entry/262144-byte limits, ticket format and conflict/order/expiry errors. `retire(principal)` deletes the ledger and releases its settled entries. It marks the ledger retired so that a pending entry releases itself on settlement. Release is idempotent: it removes an entry only if it is still in the retained list, so repeated retirement or settlement cannot double-subtract bytes. Pending entries stay unevictable. *Alternative:* keep the maps inline and add cleanup in each caller. This was rejected because the four removal sites had already diverged, and it would leave pending-settlement cleanup scattered.
2. **One browser retirement function in the server.** `retireBrowser(digest)` removes the session, retires its principal's ledger and destroys its streams. Expiry pruning, eviction, logout, credential replacement and shutdown all call it. A second call finds no session and does nothing. Streams re-authorize every second, so an expired session's stream also closes on its next tick.
3. **Liveness re-check before any effect.** Authorization happens before request bodies are read and before MCP handlers await. Every write route (monitor, controller, integration and playback) re-checks after reading its body, and `command` and `sessions` re-check before using a ticket. A principal must still be the live browser session's credential or the current configured credential object; otherwise the request is `unauthenticated`. Matching the object rather than the ID means a configured credential rotated or narrowed under the same ID also refuses late work. This prevents a retired principal from recreating a ledger or reaching a controller. `authenticate` now prunes expired sessions on every call, so expiry takes effect even when only configured credentials are active.
4. **Configured logout is not retirement.** Logout retires only a browser session whose digest and principal match. Configured credentials keep their ledger, retained results and streams. Other consumers, such as the Pixoo facade sharing a configured credential, no longer lose their stream when a dashboard disconnects. *Alternative:* keep closing that principal's streams. This was rejected because the dashboard already aborts its own stream on disconnect, and closing shared streams disrupts other consumers.
5. **Counts without an endpoint.** The host handle exposes `resources()` for in-process tests: browser sessions, launch codes, streams, ledgers, replay entries, bytes and pending entries. No credentials or session content are included, and no HTTP route is added.

## Ownership, ordering and recovery

- The host process is the single owner of these in-memory resources; nothing persists across restart, and restart already changes every ticket epoch.
- Duplicate behaviour: an identical repeated command before retirement returns the retained promise; after retirement the bearer is refused before replay. A configured credential's identical repeat returns its retained result; a different body on an old ticket is `request-conflict`.
- Timeout: the three-second HTTP response timeout abandons only the response. The admitted operation continues, stays charged, and releases on settlement.
- Failure: a rejected operation settles and releases exactly like a resolved one.
- Diagnosis: `resources()` in tests; operators see only the unchanged capacity errors.

## Risks / Trade-offs

- [Pending work retained after retirement can still hold capacity] → Intentional: pending work is never evicted, and settlement releases it. The existing 256-entry bound still applies.
- [Configured-credential logout no longer closes that principal's streams] → Documented behaviour change; a dashboard's own stream is closed by the page on disconnect.
- [Pruning on every authentication adds a scan] → At most 8 launch codes and 16 sessions.
- [Overlap with the Hub #222 stream refactor in the same file] → Rebased onto #222's merge (`2145747`). Its shared feed ticks still re-authorize each stream, and `retireBrowser` still closes a retired session's streams by owner.

## Migration Plan

Source-only. The installed hub keeps running its current artifact until a separately authorized installation. No persistent format changes, so rollback is redeploying the previous artifact.
