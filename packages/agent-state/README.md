# Shared agent state

`@jimmie-potts/agent-state` 1.0.0 interprets lifecycle metadata once for registered
consumers. It exports the owner, versioned snapshots, provider normalizers, and
bounded emitters. It starts no backend and sends no device commands. Pixoo's
existing backend is the first production host, through
[Pixoo #31](https://github.com/jimmie-potts/divoom-app-upgrade/issues/31).

## Embedding and ownership

Call `createAgentState({storage, ownerId, consumers, clock?, storageTimeoutMs?})`.
The optional clock returns nonnegative, safe integer milliseconds and defaults
to `Date.now`. Reduction uses this clock; backward movement clamps to the last
durable commit. A host has exactly one active owner. Persist its neutral owner ID
and consumer configuration across restarts. See [the typed example](examples/embed.ts).

| Operation | Result |
| --- | --- |
| `ingest(unknown)` | Validates a lifecycle 1.0 envelope, then returns applied, duplicate, stale, ambiguous or a fixed rejection code. |
| `snapshot()` | Detached, deeply frozen current snapshot. It contains observation age and collector health separately. |
| `subscribe(consumerId, cursor?)` | One bounded async iterator per registered consumer. Revision notifications tell the consumer to read `snapshot()`. |
| `acknowledge(identity, noticeId, consumerId)` | Durably acknowledges that notice for that consumer. It does not prove readership or clear attention. |
| `setLabel(identity, stringOrNull)` | Persists an explicit user label or removes it. It does not refresh session evidence. |
| `journal()` / `maintain()` | Read retained diagnostics or force durable retention maintenance. |
| `exportState()` | Quiesces admission, drains accepted work, and returns a validated frozen version 1.0 export. |
| `shutdown()` | Quiesces and drains admission, settles outstanding storage before releasing ownership, and closes subscriptions. |

All host storage operations have a maximum three-second deadline. The host
adapter must acquire an exclusive lease across its own processes, load one
versioned state, and atomically apply each `Commit`. `expectedRevision` is a
compare-and-swap guard. `null` means an empty destination. `replace` initializes
or imports the state; ordinary commits upsert the supplied session, append the
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
end retains notices. An evidenced new turn clears prior-turn notices only for
consumers configured with `clearOnNewTurn`. Without comparable ordering, the
current turn becomes unknown when different known turns conflict, neither turn
is permanently retired, and notice acknowledgment stays explicit. Contradictory
unordered activity also becomes unknown. Further receipt alone cannot remove
that ambiguity. Correlated attention and completion notices remain available
under their original turn identities.
Attention resolution requires matching known turn and attention IDs.

A qualified sequence can establish a newer turn even when its first received
observation is attention or completion. The owner retains that observation
immediately. A delayed start cannot erase it or revive activity after a newer
completion for the same turn.

Known retired turns and per-dimension sequence watermarks reject stale changes.
The last 256 validated deduplication keys per session suppress retries. Reuse of
a native event ID with different content records ambiguity. Known-turn notice
IDs are stable even after the retry window expires. Unknown ordering is visible;
the reducer never invents native sequence numbers, parents, success or readership.

Five minutes without fresh session evidence changes freshness to `uncertain`.
Duplicates, labels and acknowledgments do not refresh it. Restored sessions remain
uncertain until accepted fresh evidence. Collector health reports the owner's
ability to collect, independent of whether a session has become stale.

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
| Sessions / registered consumers | 128 / 16 |
| Attention / retained notices per session | 64 / 128 |
| Retired turns / retry keys / ordering watermarks per session | 256 each |
| Snapshot or migration input | 16 MiB, depth 20, 1,000,000 JSON nodes |
| Hook raw stdin / configuration file | 64 KiB / 8 KiB |

Journal pruning runs on writes, startup, and a timer while the owner is running.
Reads also exclude expired rows. Hosts can call `maintain()` after an injected
clock advance. Quiesced or stopped stores prune when ownership resumes.
Capacity rejection is observable and retains existing state and notices. A host
must surface saturation for operator action; it must not silently discard state
to make room. Revision exhaustion also rejects admission.

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
| Agent state 1.0.0 | Lifecycle envelopes 1.0 from lifecycle package 1.0.0 |
| Snapshots / durable exports | Closed version 1.0 schemas; unknown fields or versions reject |
| JavaScript/TypeScript | Node 24, exported ESM declarations |
| Python snapshot consumer | Python 3.12 or 3.14 with `requirements-contracts.txt` |

Python imports `agent_state.validate_snapshot` with the extracted package's
`python/` on `PYTHONPATH`. Keep the adjacent `schemas/` directory intact. Both
languages consume the same fixture corpus; Python contains no reducer.

To move ownership, quiesce/export the old owner, preserve its validated export,
shut it down and verify release, then create the new owner with `importState` and
an empty destination. Owner ID, consumer policy, session identity, revisions,
labels and acknowledgments must match. Import rejects an occupied destination.
Version 1.0 has no predecessor migration; unsupported versions fail closed.
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
