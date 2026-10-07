## Context

See proposal.md for why. ADR 0012 puts the session owner in the runtime's core, publishing state, removal and
occurrence messages through an outbox committed with each change. `@jimmie-potts/agent-state` is the reference
reducer, with an exclusive-lease `Storage` contract whose `commit` receives each change, and the old Hub keeps using it
until #839. The SDK's outbox (#882, hardened in #948) commits messages in a caller's SQLite transaction and resolves
after the commit even when the publish is refused. The scenario catalog (#846) and disposable runs (#920) host a
stand-in core that this story replaces as the session owner.

## Goals / Non-Goals

**Goals:**
- One owner of agent sessions in the runtime, with the reducer unchanged.
- Each change and its messages in one SQLite transaction; a crash loses or duplicates none.
- A full disk refuses before anything reports acceptance; a refused publication is never a rollback.
- Freshness that holds at each message's time, with the revision raised when it changes.
- An extension point that #782 and #923 build on without changing the core.

**Non-Goals:**
- The tracker, history read API and outcome intake (#782), and the inbox (#923).
- Manifest contributions and the snapshot read API (#835), the dashboard (#922), hook emission (#926).
- Importing the installed Hub's sessions: they start fresh at the cutover (#840).

## Decisions

**Derive the 2.0 messages inside agent-state's commit.** The store adapter receives each `Commit`, applies it to its
mirror of the last committed state as the Hub's adapter does, and derives the change's messages from the old and new
sessions in the same call, before its one SQLite transaction. The core reduces one observation at a time and names it
to the store, so the commit it causes takes its occurrences, `(source, id)` and trace from it; a commit no observation
caused (expiry, settlement, recovery, an acknowledgment, a label) is owner-started. Rejected: committing the messages
after `ingest` returns, which would split the change from its messages; and changing agent-state to pass its
observation in the `Commit`, which an unchanged import covers.

**Records are a projection; changes are diffs.** Every commit projects all stored sessions to `session/2.0` records at
the change's instant and publishes each one whose content differs from the stored projection. That catches parents
whose child counts changed, freshness that turned, and restart uncertainty, without special cases. The projection is
stored with the change, so sync serves exactly what was published.

**One revision counter.** The core's revision rises once per change that publishes, never below agent-state's
revision for it, so a record's generation (agent-state's admission revision) is never after its revision. A freshness
change is a core-only transaction at a new revision; agent-state has no commit for it. Parts use the same counter, so a
sync's revision covers every family it serves.

**Commit detection without awaiting publication.** The outbox resolves only after its publication. The store bumps a
commit counter in each transaction and reads it back, so it knows at once whether the transaction committed, returns
to agent-state, and lets the publication finish on its own. Awaiting it would let agent-state's three-second storage
deadline turn a slow publication into a reported rollback.

**The lease.** The Hub held an exclusive transaction on a separate lock database; the core does the same with
`core.sqlite-owner` beside its store, and waits for another holder until agent-state's deadline instead of refusing at
once. The store takes the lock with agent-state's first lease and keeps it until the core stops: agent-state's release
ends only its lease, so a faulted owner is opened again on a store the core never let go of (PR #962 review). The first
version released the lock with each lease, which let a waiting runtime win it in the gap and left the first core's
cached revision and records stale. Each lease now reloads them from the file. The lock database has no rollback
journal, because `BEGIN EXCLUSIVE` otherwise opens one, which fails on a full disk. Holding SQLite's exclusive locking mode on the store itself was tried first: it blocked a runtime restarted in
the same process (the in-memory harness's crash) from even opening the file. In-process holders are tracked by path,
so a waiting attempt never opens the file while another lease holds it.

**Full disk.** A transaction that fails with `SQLITE_FULL` rolls back; the store names the failure, agent-state faults,
and the core logs the intake `rejected` with `capacity` and opens the owner again on what committed. A full disk never
fails the core (PR #962 review): an owner that cannot be opened again, as when maintenance falls due, a full disk at the
start and a refresh the store refuses all leave it running, refusing durable work and trying again after a backoff that
doubles from 1 s to 60 s. Otherwise a full disk would end the runtime and loop on restart. The condition is recorded
once, summarized at most once a minute and closed on recovery, per ADR 0012's repetition rule. Tests make SQLite itself
refuse: small pages and a page limit at the file's size after `VACUUM`. That limit lets a change that frees space
through, which a real full disk would refuse for want of room for its journal, so the maintenance tests have a part
fail every change with SQLite's full-disk code instead.

**Restart uncertainty and host session IDs live in the core.** agent-state keeps both in memory and offers no way to
read them inside a commit. The core marks every session it loads at start restart-uncertain and clears the mark on a
committed lifecycle observation that changed the record's evidence instants. That errs only toward uncertainty, when
fresh evidence lands in the same millisecond as the evidence before a restart. It keeps the host session ID with the
record, as agent-state's 1.2 rule sets and clears it, which ADR 0011 allows in the private store.

**Owner-started clearings.** With no observation, a clearing carries the session's current turn, the owner's instant
and unknown ordering. Claiming the record's ordering would assert a provider sequence the owner never saw.

**Acknowledgments.** A consumer acknowledges for itself: the sender's source must end in the consumer ID. The core
commits before it replies, so `accepted` reports a committed change, and the session's new revision is the evidence. An
outcome would sit in the core's own outbox with no one to acknowledge it.

**Fixtures from a reference history.** A runtime test replays one history through the store and its owner and
compares #842's root session fixtures with what was published; `BUNNY_WRITE_REFERENCE=1` rewrites them. The owner's
notice ID for the finished turn replaces the one the fixtures named, and `session-at-5` becomes `session-at-2`, its
revision.

## Risks / Trade-offs

- [A sync's states are computed at the provider's instant.] The SDK stamps them a microtask later and lets no provider
  name the time, so a record that crosses the five-minute line within that millisecond can disagree with its envelope
  by one millisecond. The core's timer usually publishes the change first. The SDK owner can let a provider name its
  snapshot's time.
- [The consumer list is fixed with the store.] agent-state refuses a store whose consumers differ, so adding one needs
  an export and import. Module configuration (#919) and the cutover (#840) should settle it before sessions are kept.
- [Same-process crash in tests.] The harness's crash leaves the old core alive until its stop finishes; the lease wait
  covers that.

## Migration Plan

None: sessions start fresh at the cutover (#840), and the old Hub's store stays in its verified backup. The core reads
the old format, so an explicit import remains possible.
