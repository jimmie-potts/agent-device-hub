# Shared agent state

`@jimmie-potts/agent-state` 3.2.0 interprets lifecycle metadata once for registered
consumers. It exports the owner, versioned snapshots, provider normalizers, and
bounded emitters. It starts no backend and sends no device commands. Pixoo's
existing backend is the first production host, through
[Pixoo #31](https://github.com/jimmie-potts/divoom-app-upgrade/issues/31).

## Embedding and ownership

Call `createAgentState({storage, ownerId, consumers, clock?, storageTimeoutMs?, isArchived?})`.
The optional clock returns nonnegative, safe integer milliseconds and defaults
to `Date.now`. Reduction uses this clock; backward movement clamps to the last
durable commit. A host has exactly one active owner. Persist its neutral owner ID
and consumer configuration across restarts. See [the typed example](examples/embed.ts).

| Operation | Result |
| --- | --- |
| `ingest(unknown)` | Validates a lifecycle 1.0 envelope, then returns applied, duplicate, stale, ambiguous or a fixed rejection code. |
| `snapshot(version?)` | Default 1.0 or opt-in 1.1. Detached, deeply frozen current snapshot. It contains observation age and collector health separately. |
| `subscribe(consumerId, cursor?)` | One bounded async iterator per registered consumer. Revision notifications tell the consumer to read `snapshot()`. |
| `onCommit(callback)` | Registers a listener that runs synchronously after every committed revision, from any admission path. No consumer ID or cursor; returns an unsubscribe function. A throwing listener is caught and never faults the collector or the triggering call's outcome. Callers should keep the listener cheap and defer heavier work, for example with `setImmediate`. |
| `acknowledge(identity, noticeId, consumerId)` | Durably acknowledges that notice for that consumer. It does not prove readership or clear attention. |
| `setLabel(identity, stringOrNull)` | Persists an explicit user label or removes it. It does not refresh session evidence. |
| `recoverApproval(identity, turnId, expectedRevision)` | Explicitly retires one uncertain unknown-ID approval for that exact session and turn. Requires the current revision; does not act on the provider permission. |
| `journal()` / `maintain()` | Read retained diagnostics or force durable retention maintenance. |
| `exportState()` | Quiesces admission, drains accepted work, and returns a validated frozen version 1.0 export. |
| `shutdown()` | Quiesces and drains admission, settles outstanding storage before releasing ownership, and closes subscriptions. |

All host storage operations have a maximum three-second deadline. The host
adapter must acquire an exclusive lease across its own processes, load one
versioned state, and atomically apply each `Commit`. `expectedRevision` is a
compare-and-swap guard. `null` means an empty destination. `replace` initializes,
imports or expires state; ordinary commits upsert the supplied session, append the
optional journal row, remove journal rows at or before `pruneBeforeMs`, retain
the newest 10,000 rows, and update revision/time in one transaction. No current
session, label or notice is subject to journal retention.

Abort must prevent subsequent writes. If the adapter cannot cancel a pending
operation, it must retain the lease until the operation settles. A failed or
ambiguous commit faults the owner and publishes no speculative state. Restart
loads whichever atomic revision actually committed. Errors contain fixed codes.
`MemoryStorage` is a reference test adapter with an in-process lease; production
hosts must implement durable storage and cross-process exclusivity. Keep that
database private to its host. Never share a live database between Windows and WSL.

Explicit approval recovery returns a guarded result and records an
`attention.resolved` journal entry with `outcome: ambiguous` and a distinct
`recoveryJournalKey(identity, turnId)` session hash. Ordinary provider entries
use the identity hash, so the recovery key identifies this action after restart
when its identity and turn are known. The existing version 1.0 journal form
keeps rollback readers compatible. The entry records monitor recovery, not
evidence that Codex resolved the permission; it does not identify the actor.

## State and uncertainty

The full provider, client, host, source and session tuple identifies a session.
Project IDs and labels never merge sessions. Known child identity and parent
evidence determine child counts; missing parentage remains unknown. Conflicting
parent selectors make parentage unknown and exclude that child from either
parent's count. Missing or contradictory child activity contributes to the
uncertain count. Observation freshness remains a separate field. A provider
installation must qualify the separation of its root and child IDs before it
enables collection. Any supported hook carrying `agent_id` identifies that child
and its parent. The normalizer does not reuse the parent's turn ID for the child.

Activity, continuing questions, blocked attention, completion notices, read
evidence and unavailable evidence remain separate. An interruption or runtime
end retains notices. A selected new turn clears prior known-turn completion
notices only for consumers configured with `clearOnNewTurn`. Attention resolution
requires matching known turn and attention IDs, including after that turn retires.
An unordered attention event does not select a different current turn.

When provider ordering is unknown and no qualified activity ordering governs the
session, a valid start for an unremembered known turn selects it as active. A
matching stop makes it idle and retains a completion notice. Ordinary Codex
Desktop `UserPromptSubmit A`, `Stop A`, `UserPromptSubmit B` therefore produces
active, idle, active. This is a best-effort calculation from receipt order.
An unseen delayed start can select the wrong turn or clear a notice prematurely.
IDs are opaque; neither their spelling nor receipt timestamps prove provider order.
The snapshot continues to report unknown ordering.

Known retired activity and starts for retained completed turns cannot replace
current activity. Repeated unordered starts/stops do not refresh evidence or
restore a cleared notice, even when their receipt timestamp changes. A missing
turn or a conflicting stop for an unselected turn leaves uncertainty visible.
A genuinely new eligible start recovers activity/turn ambiguity, including in a
saved version 1.0 session, while retaining parent/order uncertainty, labels,
attention, read evidence and unrelated notices. The exception is an approval
without a request ID on the turn that start retires: a newer turn proves it was
answered, so the owner forgets it, and a late one for a retired turn is not
kept. Startup settles such markers left in older stores. Markers on the current
or a never-selected turn remain for explicit recovery or expiry. Unknown-turn notices remain
explicit. Old stores retain only hash keys for some observations, so historical
turn identities that were never saved cannot be reconstructed or rejected reliably.

A qualified sequence can establish a newer turn even when its first received
observation is attention or completion. The owner retains that observation
immediately. A delayed start cannot erase it or revive activity after a newer
completion for the same turn.

Remembered retired turns and per-dimension sequence watermarks reject stale changes.
The most recent 256 distinct retirements are kept in a FIFO. A further retirement
evicts the oldest ID, allowing current activity to continue. Retained known-turn
completion notices also prevent unordered reactivation. An ancient event whose
identity and sequence evidence have both expired may be accepted as unseen.
The last 256 validated deduplication keys per session suppress retries. Reuse of
a native event ID with different content records ambiguity. Known-turn notice
IDs are stable even after the retry window expires. Unknown ordering is visible;
the reducer never invents native sequence numbers, parents, success or readership.

Five minutes without fresh session evidence changes freshness to `uncertain`.
Duplicates, labels, acknowledgments and read evidence do not refresh it. Read
evidence also leaves restart uncertainty unchanged and cannot create a session.
Restored sessions remain uncertain until accepted fresh evidence. Collector
health reports the owner's ability to collect, independent of whether a session
has become stale.

A session with no accepted lifecycle evidence for 24 hours expires. The owner
forgets it, including its label, notices and attention, in one `replace` commit
without a journal row. Expiry is not acknowledgment, readership, success or
cancellation. It runs from the maintenance timer, at startup and before each
ingest, so a full owner frees slots before rejecting a new identity. The same
events that refresh freshness renew the window, and a restart does not reset it.
A `runtime.ended` or read observation for an unknown identity is stale, as is
any observation whose `observedAtMs` is 24 hours or more before the owner's wall
clock. Each record expires on its own clock, so a child can outlive its parent;
consumers must tolerate a missing parent. New activity after expiry creates a
fresh record with defaults.

Every committed mutation increments a safe integer revision. That revision
identifies durable content; `asOfMs`, observation age, freshness and collector
health describe the read context. An earlier snapshot never changes. Consumers
receive pointers to the current revision, not a replayable command log. Expired
or missing cursors and queue overflow yield `resync`; fetch the current snapshot
and reconcile display state without replaying old effects. Each consumer has
its own queue, so a stalled consumer cannot stall another or the reducer.

## Bounds and privacy

The design uses the frozen Hub #30 Linux budget artifact. Integrated timing and
RSS qualification remain in that issue; unit and process checks do not replace it.

| Resource | Limit |
| --- | --- |
| Normalized event | 2,048 UTF-8 bytes |
| Owner admission / each consumer / emitter | 128 pending entries; no more than 262,144 payload bytes |
| Journal | Newest 10,000 events within 24 hours |
| Sessions (expire after 24 hours without evidence) / registered consumers | 128 / 16 |
| Attention / retained notices per session | 64 / 128 |
| Retired turns / retry keys / ordering watermarks per session | 256 each |
| Snapshot or migration input | 16 MiB, depth 20, 1,000,000 JSON nodes |
| Hook raw stdin / configuration file | 64 KiB / 8 KiB |

Journal pruning runs with every commit, at startup and from a timer while the
owner is running. Session expiry runs at startup, before each ingest and from the
same timer, and its commit also prunes the journal. An ingest that commits nothing
leaves due rows for the timer, but journal reads always exclude them. Hosts can
call `maintain()` after an injected clock advance. Quiesced or stopped stores
prune and expire when ownership resumes. Capacity rejection, after expiry, is
observable and retains the remaining state and notices. A host must surface
saturation for operator action; beyond expiry, it must not silently discard
state to make room. Revision exhaustion also rejects admission.

Provider observations, calculated current state and diagnostics have separate
roles. Envelopes preserve available qualified identity/order evidence; snapshots
contain the current calculation; journal rows contain mutation summaries, not
raw envelopes. The journal cannot reconstruct a complete event history or make
old status reliable. Native envelope event IDs retain deduplication/collision
checks. An unqualified raw hook `event_id` remains outside the normalizer allowlist.

Only lifecycle allowlisted metadata reaches storage, diagnostic entries or
transport. Normalizers select fields before creating the envelope; they exclude
prompts, transcripts, tool content, automatic titles and private paths. Errors
and emitter counters never include raw payload or host exception text. Labels
and project IDs require explicit user choice. No API takes a device mode or
device address; collection remains independent of Monitor/Media/Free selection.

## Provider sources and the command hook

Import `normalizeHook` or `createEmitter` from the `/providers` export. Normalizers
cover the documented Codex and Claude lifecycle mappings in the qualified
lifecycle contract. Continuing/input operations and optional Desktop read markers
need their own qualified envelope integration; raw prose and tool names are not
classified here. Both `enabled` and `qualified` default to false. Unknown ordering
and missing turn/correlation evidence stay explicit.

The embedded emitter has one active send, a bounded queue, no retries, and an
abort deadline. A send callback must yield and obey its abort signal. If it ignores
abort, the emitter retains that single slot and drops new work until it settles.
No JavaScript timer can preempt a synchronously blocked host callback.

`node bin/hook.mjs /absolute/path/to/config.json` is a source hook entrypoint.
It reads one provider payload from stdin, normalizes it, and sends at most one
POST to an explicitly configured numeric loopback HTTP collector. It always
exits zero with empty stdout/stderr. A timer covers file reads, stdin, imports
and transport, with a 2.9-second maximum to leave startup room within the frozen
three-second return budget. It starts no child processes and follows no redirects.
Example configuration, disabled until installed-path qualification:

```json
{
  "source": {"provider":"codex","client":"cli","hostId":"host-1","sourceId":"codex-cli-1","hook":"Stop"},
  "endpoint": "http://127.0.0.1:49152/v1/agent-events",
  "enabled": false,
  "qualified": false,
  "timeoutMs": 500
}
```

The host owns the collector endpoint and its access controls. `hostId` identifies
the producing host; `sourceId` identifies one installation, execution path and
configuration. Persist them rather than regenerating them per invocation. Use a
different source ID for distinct Windows/WSL or CLI/Desktop paths. Do not derive
IDs from private paths. This package does not change hook files or provider
permissions. Hub #8 owns authorized installation and real-client qualification.

## Compatibility, migration and distribution

| Artifact | Supported contract/runtime |
| --- | --- |
| Agent state 3.0.0 | Lifecycle envelopes 1.0 from lifecycle package 1.0.0 |
| Snapshots / durable exports | Closed snapshot 1.0 and opt-in 1.1; durable 2.0 with 1.0 import; unknown fields or versions reject |
| JavaScript/TypeScript | Node 24, exported ESM declarations |
| Python snapshot consumer | Python 3.12 or 3.14 with `requirements-contracts.txt` |

Python imports `agent_state.validate_snapshot` with the extracted package's
`python/` on `PYTHONPATH`. Keep the adjacent `schemas/` directory intact. Both
languages consume the same fixture corpus; Python contains no reducer.

To move ownership, quiesce/export the old owner, preserve its validated export,
shut it down and verify release, then create the new owner with `importState` and
an empty destination. Owner ID, consumer policy, session identity, revisions,
labels and acknowledgments must match. Import rejects an occupied destination.
The new owner expires imported sessions whose last lifecycle evidence is 24 hours
old or more at startup, as it would any other store.
Durable 1.0 imports migrate to 2.0 in one guarded replacement, preserving evidence clocks and assigning existing records generation zero. Unsupported versions fail closed.
Package 2.0.0 changes selection semantics without changing storage/snapshot 1.0.
Package 2.0.1 adds explicit approval recovery without changing those schemas.
Package 2.0.2 keeps read evidence out of freshness, restart recovery and session
admission without changing those schemas.
Package 2.0.3 expires sessions after 24 hours without lifecycle evidence, also
without changing those schemas.
Package 2.0.4 forgets approvals without a request ID on retired turns without changing those schemas.
Package 3.0.0 adds durable 2.0 retirement guards and opt-in snapshot 1.1 generations. The default snapshot remains 1.0. Older owners cannot read a 2.0 store or export; rollback after new writes needs a compatible owner or an explicitly reconciled export.
Package 3.2.0 retires accepted ends on every supported path and settles stored `ended` records at startup without changing the schemas. Its Claude Code and Codex CLI retirement guards are rejected by the 3.0 and 3.1 validators regardless of age, so those owners fail closed (`invalid-storage`) on a store or export holding one. A guard expires 24 hours after its retirement, but only a running or reopened 3.2.0 owner prunes it; run or reopen 3.2.0 after that point before rolling back, or use an explicitly reconciled export.
It opens an existing compatible store directly. The frozen pre-change
[ambiguity fixture](fixtures/legacy-ambiguous-v1.md) verifies recovery without
resetting state. Older packages can read the legacy 1.0 shape, but cannot read durable 2.0. The [Hub update procedure](../../apps/hub/SETUP.md#update-the-current-status-package)
keeps owner/source configuration and the existing store.
If cutover fails, first stop/release the new owner before restarting the old
store. Rollback after new writes requires an explicit reconciled export, because
the old copy lacks those writes. No migration accesses controller databases.

`npm run package:agent-state` creates the private versioned archive and SHA-256
sidecar. `npm run test:agent-state:package` installs it outside this checkout,
checks manifests and the pinned lifecycle archive, typechecks the example, runs
the Node/process and Python fixtures, and compares repeated archive bytes. Pin
the immutable release archive and checksum in consuming repositories. The archive
bundles the private lifecycle dependency; public dependencies use exact versions.
Publication records the reviewed source revision and archive hash outside the
source commit. No checkout-relative imports or private-registry secret is needed.

## Runtime-end retirement

An accepted `runtime.ended` for a known session on any supported path (Codex Desktop, Codex CLI or Claude Code) removes the session and its known descendants in one durable replacement and publishes one revision. Removal frees capacity and forgets task labels, project overrides, attention and notices, even when notices or attention remain. It does not acknowledge, mark read, complete or cancel work, and it never terminates an agent. Ending one path's last session cannot remove another path's session, even one with the same native ID under a different selector. Ordinary completion, `SubagentStop`, interruption, input waits and freshness uncertainty retain records, and a long turn has no new timeout. Each record keeps the existing 24-hour evidence expiry fallback, so a run whose end is never delivered still expires on its own clock.

Stores written while only Codex Desktop retired may hold a Claude or CLI record whose accepted end was reduced into activity `ended`. Opening such a store retires exactly those records and their known descendants in one durable revision with the same guards. Settlement adds no journal row and performs no acknowledgment, clock reset or old-effect replay. Records with idle, waiting, interrupted or unknown activity are never treated as ended; they keep their evidence clocks and the 24-hour fallback. That includes a record whose unordered hook end left activity `unknown` under the older owner: the diagnostic journal's `runtime.ended` row is bounded history, not retirement authority, so the record waits for its own expiry. The reducer no longer produces `ended`.

Retirement guards are separate from active sessions and diagnostics: at most 128 identities for 24 hours, with up to 256 known turns, retry keys and ordering epochs per identity. They survive restart and reject recognizable delayed events, including an old end after resume. Oldest guards are evicted at the bound. A retired identity requires an eligible session or turn start; a new child naming a retired absent parent is rejected. Missing parent identity, unseen old starts, unqualified order, or evicted evidence can prevent reliable rejection. Receipt timestamps do not prove provider order.

Fresh records receive a generation from their admission revision and defaults; native selectors stay unchanged. `snapshot('1.1')` includes this generation so consumers can reset task-specific state even when they miss the removal. Default 1.0 readers observe disappearance but cannot distinguish recreation hidden between reads. A generation is scoped to the owner and its preserved revision lineage; manually replacing the owner's store is outside that continuity guarantee.

A host can supply `isArchived(identity, signal, ancestors)` for admission only. The owner checks it only for a new Desktop identity, waits at most 200 ms, and keeps at most one unsettled probe. The frozen ancestor list follows known parent links, including the first absent parent, so a delayed child can be checked against its archived conversation. Cycles are bounded by the known session count. Only a literal true supplies archive evidence; failure, timeout or an occupied probe supplies none. The host must honor cancellation, bound its work and read only the selected installation. Runtime-end retirement never invokes this callback.
