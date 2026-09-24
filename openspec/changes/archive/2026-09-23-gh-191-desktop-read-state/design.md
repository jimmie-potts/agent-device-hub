## Context

Codex Desktop on this installation keeps its state in the Windows Codex home, read from WSL under `/mnt/c`. In `.codex-global-state.json`, `electron-thread-read-state-v1` (version 1) holds `unreadByIdentity`: host keys whose values map identity keys to lists of unread thread IDs. The IDs are Codex session IDs. Nothing lists read threads. Legacy Nanoleaf read an older key that no longer exists. Desktop also lists subagent threads, which the user normally never opens.

No hook reports reads. A Linux file watcher on `/mnt/c` received no events for Windows or WSL writes, so the reader polls.

## Decisions

- **Placement.** The standalone Hub owns the reader because it already owns the agent-state engine in process. Configuration adds optional `codexDesktop: {home, hostId, sourceId}`. `home` is an absolute Codex home path; the host and source IDs select the Desktop producer's sessions.
- **Polling.** Every two seconds the reader checks the marker's size and modification time and parses it only when they change. Files over 16 MiB, invalid UTF-8/JSON, a missing key or an unexpected version or shape produce no events until a later successful parse.
- **Rule.** For each top-level session (`provider: codex`, `client: desktop`, configured host and source, parent not known):
  - listed and not already `unread` → `unread`;
  - not listed and currently `unread` → `read`;
  - not listed, `read: unknown`, activity idle, interrupted or ended, and the last session evidence at least five seconds old → `read`.
  The five-second wait matches legacy Nanoleaf: Desktop sets the unread flag shortly after Stop. Child sessions are skipped because Desktop lists unopened subagent threads as unread indefinitely.
- **Emission.** The reader ingests an event only when the desired state differs from the owner's current value. Each event carries the session's current turn, unknown parent and unknown ordering, so it does not alter turn or parent evidence.
- **Owner semantics.** `read.observed` changes only the read dimension. It does not update `lastEvidenceAtMs` or the session's `observedAtMs`, does not clear restart uncertainty, and does not create a session for an unknown identity. Otherwise, viewing a task in Desktop would make a stale or restarted session look current and would block approval recovery.

## Privacy

The reader keeps marker contents in memory only. Only `read` or `unread` for sessions the owner already knows enters shared state. It never writes, renames or locks Codex files and never reports the path or file contents through routes, logs or errors.

## Failure and recovery

Missing, inaccessible, partial or changed-format input stops emission without clearing existing read state. Ingest failures, including a staged or quiesced owner, are ignored and retried naturally on a later tick. The reader stops before the owner shuts down. A new completion returns a session to unread when Desktop lists it again; between the completion and that marker write, the session keeps its prior read value.
