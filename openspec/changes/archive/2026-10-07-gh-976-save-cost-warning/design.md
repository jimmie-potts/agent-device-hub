## Context

The core store (`apps/runtime/src/core/store.ts`) is agent-state's storage adapter. agent-state's owner commits each
change through the store's lease; the store applies the change to its copy of the last committed state (a structured
clone and `validateExport`), serializes the whole state, plans the 2.0 messages, and commits one SQLite transaction
through the SDK's outbox with the state row, the records, history, the intake's `(source, id)` and the parts' rows. The
outbox publishes only after that transaction, from a later microtask. Since #782 (PR #988) the intake commits other
participants' messages in bounded groups, and since #972 (PR #974) module databases are in WAL with one bookkeeping
commit per publication batch. Neither writes the state block.

## Goals / Non-Goals

**Goals:**
- A WARN before saves get costly, and an INFO when they are not, once per run of each condition, with only a size or a
  time.
- The records registered in the diagnostic contract, so the runtime writes them whole.

**Non-Goals:**
- #976's post-cutover reading (item 2), which waits for #840.
- The deferred list: rows per session, an unpersisted journal and their tests. "Yield between bounded intake batches"
  was delivered by #782 (PR #988).
- Timing the tracker's grouped intake commits or the freshness refreshes, which do not write the state block; the
  intake's groups are already bounded to about 50 ms of their own work.

## Decisions

- **What a save is.** The timed path is `CoreStore.#commitChange`, the lease's `commit`: from before `apply` to the
  moment the outbox's synchronous transaction has returned committed, read inside `#commit` before its publication can
  start. It includes the clone, validation and serialization the review named, the plan and every row the transaction
  writes, the parts' derivers included. It leaves out agent-state's own reduction before it calls `commit`, and the
  publication after. Only a save that commits is measured: a refused save changes no condition. Rejected: timing
  around `await this.#commit(...)` in `#commitChange`, since the outbox's sends are queued as a microtask that runs
  before that continuation and would be counted.
- **Thresholds.** `SAVE_COST` is `{stateBytes: 8 MiB, saveMs: 100}`: half of `MAX_STATE_BYTES`, which already refuses a
  larger block, and the issue's 100 ms. A block or save over the limit, never at it, counts. The store takes them, and a
  monotonic timer (`performance.now`), as options so tests can cross each one quickly and deterministically; the core
  passes neither.
- **Two conditions, one pair of events.** Size and time are tracked apart, each WARN as it starts and INFO as it ends.
  `storage.cost.high` and `storage.cost.normal` carry `bunny.operation` `storage` and exactly one of
  `bunny.state.bytes` or `bunny.save.duration_ms`, so a reader tells them apart by the attribute. The time is whole
  milliseconds rounded up, so a recorded time is over 100 exactly when the save was, bounded to one day as the contract
  bounds durations. The INFO carries the size or time of the first save back within its limit. The runs live in the
  store's memory, so a restart starts a new run and warns again if the condition still holds; nothing is persisted.
  Rejected: reusing `operation.failed` and `operation.completed`, which the core already uses for a store that refuses
  work, since a costly save is no failure and its recovery would read as a store outage ending.
- **A new profile.** A new module event or attribute is a catalog change: profile 1.5, artifact 1.5.0, as #949 and
  #835 did for 1.3 and 1.4. Each earlier profile rejects the additions. The runtime writes at 1.5, and the SDK kit
  checks a module's records at 1.5 so a module may use a module event the runtime writes. Rejected: adding to profile
  1.4, which is already on main and pinned by every consumer.
- **Failure isolation.** The records are written after the commit is known, and a logger that throws loses its record
  only. Without that, a throw would reject agent-state's `commit` after the transaction committed and fault the owner on
  a change that stands.

## Risks / Trade-offs

- **Flapping at the time limit.** Saves that alternate around 100 ms log a WARN and an INFO each time. Real hooks send
  one event at a time, so this needs sustained load near the limit; ADR 0012's "Repetition" is met by logging each
  transition once. If it shows on the real install, a hysteresis band is a small follow-up on #976.
- **Agent-state's own work is not counted.** Its reduction before `commit` also costs CPU per change; #976's reading on
  the real install will show whether that matters.
- **No reading yet.** The warning is source-only until #840 installs the runtime.

## Migration Plan

None. Producers other than the runtime keep their profiles; every consumer pins the 1.5.0 workspace artifact.
