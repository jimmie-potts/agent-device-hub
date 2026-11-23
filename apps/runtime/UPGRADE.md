# Upgrade and recover the installed runtime

ONN is hibernated after device retirement. Preserve retained ONN state and compatibility readers without activating its writer or requiring dormant-device qualification. Its historical setup references do not select active ONN use.

This procedure belongs to `bunny-runtime.service`, the current TypeScript runtime
on the established WSL installation. It preserves that installation's state,
configuration, credentials, Node executable and hooks. It does not operate the
retained Hub installation or the Mac container. The
[Mac primary-host decision](../../docs/decisions/0008-runtime-hosting.md) uses the
separate [container operator](../../docs/bunny-container.md); neither procedure
qualifies cross-host state transfer. The [fresh setup procedure](SETUP.md) remains
separate.

The initial established-runtime qualification is accepted under
[#1037](https://github.com/jimmie-potts/agent-device-hub/issues/1037#issuecomment-6102421021).
That acceptance is historical and is not repeated. Routine upgrades use the
smaller policy selected in [#1133](https://github.com/jimmie-potts/agent-device-hub/issues/1133):
verify reviewed release bytes, preserve one installation lock, take a consistent
stopped-writer backup, and verify running identity/health and durable receipts.
Assess actual storage changes with focused evidence. Historical per-owner
baseline/candidate/recovery/reupgrade certificates and broad format inventories
are no longer routine forward gates. Independent reviews and CI still apply.

Recovery eligibility is separate. Unknown recovery permits a forward plan and
refuses recovery selection/checks. A failed forward update may require fixing
forward. Never silently restore a snapshot: that requires a separate explicit
owner decision, preservation of failed latest state and an honest data-gap report.
First release-anchor adoption remains separately authorized and is not repeated.

BB-8 is hibernated. Inventory and preserve its retained Linux files without
opening its database, requiring historical reader certificates, running dormant
suites or starting its Windows helper. This upgrade does not touch the separately
owned Windows data or qualify/reactivate either BB-8 component.

## Weekly routine state

Core automation stores weekly routines (#1297) as `rules.kind = routine` with
`trigger.schema = routine/1.0`. The trigger contains selected weekday numbers
and one `HH:MM` time; the action contains an opaque definition identity and the
ordered action list, each entry naming a configured target, a tracked command
family, that family's payload and, for a content action, the required mode. The
bounded per-rule occurrence guard records the latest claimed occurrence before
dispatch, never a pending command to replay. Definitions and guards remain in
the private core database under its existing lease.

Releases before #1297 stored one on/off power window per row as
`trigger.schema = power-window/1.0`. The #1297 release migrates every such row
at its first open: the row keeps its id, definition identity and guard and
becomes the on routine with a `power-set on` action; a new row with a copy of
the guard becomes the off routine. The migration reads each replacement back
through the routine reader before writing and commits all splits in one
transaction, so a row it cannot read, or a replacement the reader would refuse,
refuses the open and leaves every row unchanged. The added rows bypass the
64-rule limit; more than 32 windows leave a store that refuses new rules with
`capacity` until rows are removed. An older release
cannot read `routine/1.0` rows, so recovery to it is unknown unless separately
qualified; prefer fixing forward.

Assess changed routine readers/stores with focused write/reopen evidence.
Event-only releases reject routine rows and cannot be assumed compatible recovery
readers once routines exist. Preserve definitions and occurrence guards. An
unknown older reader does not block a reviewed forward upgrade, and cannot be
selected for recovery. This delivery activates no installed routine.

Automation definition publication adds `automation_definition_revisions` to the
core store. It holds the last published revision for each current rule, routine,
settings record and interrupt set. Earlier values start at revision zero until
an effective edit, without a history backfill. Definition rows and occurrence
guards retain their formats. An effective save or deletion commits the owner rows, revision metadata,
retained history and pending outbox fact together. A pending automation state
or rule or routine removal that becomes protected can be discarded without
changing the committed owner rows or private history. Preserve those tables
together. Assess return to an earlier reader with the selected release and its
latest state, including any unpublished definition messages. The additive table
alone does not establish recovery eligibility.

Maximum-on definitions and run evidence add `automation_power_limits` to the core
store. Preserve each target's owner/configuration binding, enable/duration,
settings and definition revisions, original known/unknown start, observed run
state and one shutoff-attempt identity. The core also publishes `power-limit/2.0`
through its transaction/outbox. Wemo adds private `wemo.sqlite` request/device
fences and its module folder's writer leases. A retained uncertain hold and
unacknowledged outcomes must survive without another device write.

Weather's `weather.sqlite` holds its revision, last observation time and change
baseline. It is not a durable owner: losing it costs one change baseline and resets
the revision. In-process copies restart with the runtime. A remote copy that
outlived it would ignore new records until the revision catches up, and gets no
prompt words once its record is stale; no remote consumer exists today. No recovery
depends on it.

Configured Wemo requires its primary store and ordinary healthy running state.
Preserve retained inactive Wemo state without mandatory phase certificates.
Assess changes to limit/Wemo formats using focused production-store evidence;
four same-source processes establish persistence only. Recovery eligibility
must reflect the actual older reader on latest state. Do not clear settings,
fences or holds, omit retained ownership or restore an older snapshot to make
a recovery appear eligible.

Volcano adds private `volcano.sqlite`, which holds usage facts that nothing deletes,
the gap threshold and threshold request fences. Configured Volcano requires its
primary store. Preserve a retained store when its section goes.

Art adds private `art.sqlite`, which holds its job rows, the spending ledger, the
catalog and its bytes. It is a durable owner: favorites and spend cannot be rebuilt, so
configured Art requires its primary store and ordinary healthy running state, and a
retained store stays when its section is gone. A restart leaves every in-flight call
uncertain with its reservation kept, and resends nothing.

## Core history fact log

The #1740 release changes the core store's `core_history` (`modules/core.sqlite`).
This section applies to every core store, including the Mac container's state
volume, whose operator [docs/bunny-container.md](../../docs/bunny-container.md)
points here. At its first open, in one transaction, the core creates the one-row table
`core_origin` holding a random UUID, the installation's origin, adds the
nullable columns `origin` and `origin_seq`, and gives every existing row that
origin and a sequence from 1 in `seq` order. It replaces the unique index on
`(source, message_id)` with unique indexes on `(origin, origin_seq)` and
`(origin, source, message_id)`. No other column, row or table changes. A failure
rolls the whole step back and leaves the core unavailable, as a full disk does,
until the cause is fixed; nothing is half-migrated. Opening a migrated store
again changes nothing.

The step rewrites every history row once, all in one transaction, so the
write-ahead log `core.sqlite-wal` holds a new copy of every history page and both
new indexes. The extra space measured about the store's size plus 90 to 260 bytes
per history row, across this change's measurements and the independent review's,
so it is largest, as a multiple of the store, for small rows. On
synthetic stores with the runtime's database settings, the extra space at the
peak was:

| Average row (store size / rows) | Rows | Extra space, times the store | Time |
|---|---|---|---|
| 159 bytes | 200,000 | 2.14 | 0.3 s |
| 203 bytes | 200,000 | 1.96 | 0.4 s |
| 390 bytes | 400,000 | 1.58 | 1.0 s |
| 868 bytes | 100,000 | 1.13 | 0.4 s |
| 4,130 bytes | 50,000 | 1.02 | 0.6 s |

Before the first start of this release, check that free space is at least 2.5
times the size of the core store, in addition to the space the backup step needs.
A history row is rarely under 200 bytes. With less, the first start can fail as
full: the store rolls back unchanged, but the upgrade window is spent, and the log
keeps its grown size until the core stops. The core retries with backoff while it
runs, and a later attempt reuses that space.

The new indexes are built with a sort that SQLite may spill to temporary files.
In the Mac container these go to `/tmp`, a 256 MB tmpfs
(`deploy/container/compose.yaml`). That was not measured; at about 100 bytes per
index entry it would cover roughly two million history rows.

The log keeps its size for as long as the core runs.
SQLite's automatic checkpoints copy its pages into the store but never shrink the
file, and the runtime runs no checkpoint of its own. A clean stop of the core
checkpoints the log into the store and removes it, which gives the space back.
After a crash or kill the log stays at its size through the next start, until
that run's clean stop. No other operator step is needed.

The change is forward-only. An older release run on a migrated store ignores the
new columns, recreates its own message index and writes rows without an origin;
the next start of this release gives those rows the origin and the next
sequences. This follows from the code and focused tests, not from a qualified
recovery, so recovery stays unknown unless separately qualified; prefer fixing
forward.

## One-time session reset

The #1865 storage release (its group 7) moves agent sessions out of the old
agent-state block into the core store's own tables, `core_sessions` and
`core_session_guards`, in `modules/core.sqlite`. This section applies to every
core store, including the Mac container's state volume. Session monitoring
state starts empty once; the owner accepted the downtime and the loss of
session-monitoring data, and recovery is fix-forward (2026-11-18).

The first start of this release that finds the old `state` table runs the reset
in the core's start, before the core serves a sync or republishes, in one
SQLite transaction. It:

- drops the `state` table, which held the old owner's sessions, retirement
  guards and journal;
- empties `core_sessions` and `core_session_guards`;
- deletes the session family's published records from `core_records`, and its
  rows from `core_history_latest` and `core_history_span`, so the first new
  history row of each session is a change from nothing;
- deletes pending outbox messages whose routing keys are session states or
  removals (`bunny.state.session.*`) or agent occurrences
  (`bunny.event.attention-raised.*`, `bunny.event.attention-cleared.*`,
  `bunny.event.turn-ended.*`, `bunny.event.session-ended.*`), so they never
  go out;
- raises the core revision in `core_revision` by one.

It publishes nothing: no removal, no occurrence and no history row, so no
automation runs. It records one `operation.completed` with `bunny.operation`
`storage`. The next sync serves an empty session family at a revision no earlier
payload carried. Every module in the runtime syncs again after the restart, and
remote consumers resync when their stream restarts. Each live session returns
at its next observation, with a new generation. History fact rows, the outbox's
other messages, the taken `(source, id)` records and every other part's tables
and rows stay as they are.

The old data's presence is the reset's only key: no marker is stored. Once the
`state` table is gone, a later start finds nothing to drop and changes nothing.
On failure:

| Fault | Behavior | Recovery |
|---|---|---|
| Crash or power loss during the reset | The transaction commits whole or not at all | The next start runs the reset again |
| Full disk at the reset, whether at creating the new tables or in the reset's own transaction | The store does not open and exposes nothing: no pending message goes out, no part commits and the revision stays as stored. The core keeps running, refuses intake with `capacity` and syncs with `unavailable` | The next intake or sync after a backoff that doubles from 1 s to 60 s opens the store again, and the reset runs once there is room |
| A second runtime on the same state directory | Refused at the lease or the database, before its core opens the store | None needed; the first keeps running |

Rolling back below this release is unsupported for session data. An earlier
release run on a reset store starts with empty session state and writes a new
`state` table; it does not read the new session tables. The next start of this
release finds that table and runs the reset again, emptying the new session
tables too. This follows from the code and focused tests, not from a qualified
recovery. Prefer fixing forward.

The #1865 restart release (its group 8) stores a restart marking,
`restartUnconfirmed`, in the JSON of a session whose work was running at a
start. It changes no table. Rolling back from it to the group 7 release keeps
the session rows and the marking, which group 7 neither reads nor clears.
After a forward upgrade again, the first start's transaction clears the
marking on every session whose work is no longer running, and marks the
sessions whose work runs, so a stale marking does not outlast that start.

## Work deadline removal (#1947)

The #1947 release removes #1865's five-minute work deadline. It changes no
table. On a store that `037b327a` (#1865 step 9) wrote, the first start's
transaction, which already marks running work unconfirmed for the restart:

- removes `deadlineUnconfirmed` and `progressAtMs` from the JSON of every
  stored session in `core_sessions`;
- marks running work that the deadline had left unconfirmed as unconfirmed for
  the restart (reason `restart`), so it no longer shows reason `deadline`;
- publishes each changed record once, at one new revision, with no occurrence,
  and history keeps each as a change row.

Qualifying evidence on the session's current turn then confirms the work, as
after any restart. Published records, outbox messages and history rows that
carry the reason `deadline` stay as they are: `session/3.0` keeps that value
accepted, never emitted, so they still read. From this release on, a session
publication whose only changes are its evidence instants writes no history row
and confirms the session's span (see [Core history spans](#core-history-spans)).

Returning to `037b327a` on a store this release opened rests on a code reading
of `037b327a`, not on a test that opens such a store with that code: that
release finds no deadline fields, starts the work deadline
of running work that a restart did not mark from its last evidence, and writes a
history row for each session publication again. Prefer fixing forward.

## Conversations running at once (#2027)

The #2027 release lets each assistant conversation run its own task at the
same time. It adds the `assistant_conversation_changes` table, which records
the assistant revision of each conversation's last change, so a command is
refused as stale only when its own conversation changed. Each start raises
every saved conversation to at least the revision at start, so a command naming
an older revision is refused, as is one whose conversation changed at startup. No record is
rewritten.

An earlier release keeps one running slot and reconciles only one unfinished
task at startup (`LIMIT 1`), so it would leave any other unfinished task as it
was saved, a running one included. Before returning below this release, end or
cancel every conversation's unfinished task in Conversation, then disable the
conversation, which Conversation refuses while any conversation has an
unfinished task. The earlier release ignores the added table, and installing
this release again later raises its rows at the first start. Prefer fixing
forward.

## Anthropic monthly spend limit and built-in prices (#2047)

The #2047 release prices the assistant's calls from a dated built-in table
(Anthropic's price list of 2026-11-22), so `assistant.prices` no longer needs
entering; a configured price still overrides the table. Anthropic now enforces
the monthly ceiling. The local ledger paces each day at $20 and shows the
month as an estimate. An upgrade straight to this release skips the #2024 and
#2025 steps below that add prices; the default title model,
`claude-haiku-5-5`, is priced at its built-in tiers. The release changes no
table and rewrites no record.

One-time owner setup, in the Anthropic Console, before the hosted provider goes
live (the [companions guide](../../modules/companions/README.md#spend-limits)
has the details):

1. Create a dedicated workspace for B.U.N.N.Y. Do not use the default
   workspace: a limit there might not count or stop all usage, and on some
   platforms it cannot be set.
2. Set that workspace's monthly spend limit to $150 at
   `platform.claude.com/settings/spend-limits`.
3. Create an API key in that workspace and store it in the companions key file
   (`secrets.anthropic-api-key`) through the established private configuration
   route, then restart the runtime.

Coding-worker runs and other providers, such as the art module's, are outside
this workspace's limit and the assistant's ledger.

To return to the #2025 release, first add `assistant.prices` for the
configured model and the title model. Without them, that release refuses every
paid turn, naming the missing price, and refuses every title call, which it
records as `capacity` while the persona name stays. The module still starts.
The #2024 release has no title calls; to return to it, add a price for the
configured model first. The workspace's limit stays in force either way.

## Conversation titles (#2025)

The #2025 release gives each assistant conversation a model-written title and
lets the owner rename it. When the companions provider is `anthropic`, add a
price entry to `assistant.prices` for the title model: the default
`claude-haiku-5-5`, or the model named by the optional `assistant.titleModel`.
The section and the module start without it, but the spend ledger then
refuses every title call, so conversations keep their persona names. The
synthetic provider needs no change and makes no title call.

The companions module's first start adds the empty `assistant_titles` and
`assistant_title_calls` tables. Each conversation is titled after its next
message; until then it keeps its persona name.

To return below this release, remove `assistant.titleModel` from the section
first, because an earlier release refuses the key. The earlier release ignores
the two tables and titles every conversation by its persona again.

## Assistant limits, prompt caching and spend (#2024)

The #2024 release relaxes the assistant's per-turn limits, caches its prompts
and bounds its spend at $20 a day and $150 a month. `assistant.prices` is a new,
optional key of the companions section. An earlier release refuses the key, and
this release accepts a section with or without it, so change the release and
the section one at a time:

1. Upgrade with the section unchanged. The module starts. While its provider
   is `anthropic` and the section has no price for its model, every new paid
   message and model call is refused with `capacity`, naming the missing price.
   Details and the composer say so. Reachy, MicroDuck, preferences, knowledge,
   speech and the coding worker are unaffected.
2. Then add `assistant.prices` with an entry for the configured model, as the
   [companions guide](../../modules/companions/README.md#section-provider-and-permitted-tools)
   describes, and restart the runtime.

The synthetic provider needs no prices.

The companions module's first start adds the empty `assistant_spend` table. It
rewrites no saved task, call or message, and tasks saved earlier keep their
counters under the larger limits. Spend counts from the first paid call after
the upgrade; calls made before it are not in the ledger.

To return below this release, first remove `assistant.prices` from the section
and restart on this release, which accepts the section either way. Then return.
The earlier release ignores the `assistant_spend` table and enforces no spend
limit. A task whose saved counters pass its smaller limits cannot continue
there. That release also reads history pages under its old 64 KiB bound. A saved
owner message near the new 32 KiB limit whose JSON escaping passes 64 KiB, such
as one of control characters, makes its recent-history read refuse that
profile's conversation with `capacity`.

## Pixoo brightness confirmation (#1990)

Companions adds an empty `assistant_confirmations` table for outstanding
read-only watches and an optional `assistant_messages.follows` column that
links a later result to its earlier reply. Earlier messages read with a null
link. The Pixoo store keeps recent request-linked brightness readings in its
existing state table. An interrupted read retires as unavailable on startup.
The tracked write retains its committed outcome and does not run again.

Keep these records with the stopped-writer backup. Check both stores reopen
with saved messages and readbacks intact before qualifying the forward batch.
Recovery to an earlier revision needs its own assessment of pending watches
and retained device state.

## Wemo power confirmation (#1991)

The Wemo store retains bounded readbacks in the existing plug record. Earlier
records have no readbacks. A pending read at startup becomes unavailable, with
the transmitted outcome and any uncertain-write hold preserved. Companions
reads earlier brightness watches alongside power watches. Before a forward
batch, verify that both stores reopen and that the core retains the original
maximum-on timing. Assess earlier readers on the selected recovery revision.

## Native assistant conversation sessions (#505)

The #505 release reports each B.U.N.N.Y. assistant profile's conversation as
one session of the native source, with one turn per task. It changes no core
table. Records the store holds stay `session/3.0`, and the core keeps
publishing every Codex and Claude record as `session/3.0` with 2.0
occurrences, so read-receipt helpers from an earlier host release keep
working. A native conversation's record is `session/3.1` and its occurrences
are 2.1; those helpers skip it.

The companions module's first start adds the `assistant_reports` table, one
row per conversation, and records each conversation's latest task as already
reported. A latest task that had ended, or that waits on delegated work,
reports nothing and first appears on the devices when its conversation next
changes. A latest task that waits on the owner's answer or approval is
reported by that same start: its turn start, its question and its wait, so it
appears at once as needing the owner. A task that was running when the runtime
stopped is recovered by that same start as paused, uncertain or, when its graph
had already completed, succeeded, and that recovery is its first report: one
`turn-interrupted`, `turn-uncertain` or `turn-ended` with its result, so it
appears at once as quiet, unknown or finished. A running task that already
holds a saved, unanswered question, which the engine saves before the graph's
interrupt, waits on the owner in the same sense: that start reports it whole,
its turn start, its question and how the recovery left its work, so it appears
as needing the owner.

### No return below this release while a native session is stored

A release before this one cannot publish a native session's record. It labels
every record `session/3.0`, whose schema names no native source, and its
validator refuses a native record (`invalid-message`, `payload /identity/client`).
That release republishes a stored record when its start or its first refresh
changes it: the start transaction marks running work unconfirmed, and the
record it rebuilds drops a notice's `result`. A stored native session with
running work or a notice result is therefore republished in every commit that
publishes, and the refusal rolls each such commit back. Until every such
session has gone a day without evidence and expired, the operator sees:

- at start, an `operation.failed` record (WARN) with `bunny.operation`
  `storage` and `bunny.code` `unavailable`;
- for every agent's lifecycle observation, Claude's and Codex's included, a
  `message.received` record with `bunny.outcome` `rejected` and
  `bunny.code` `unavailable` (WARN) while the start transaction has work to
  commit, which any running session gives it, or `bunny.code` `internal`
  (ERROR) when it has none and the observation's own commit fails (the store's
  internal outcome is `storage-failed` in both);
- for every core sync, any family, the reply `unavailable` with the detail
  "the core cannot bring its sessions up to date now".

A store that holds only native sessions with neither running work nor a
result opens cleanly, but any later change to such a session would be refused
the same way. A conversation's session keeps the result of every task it
reported since it last expired, so that holds only for a conversation whose
reported tasks have none, such as one whose only reported task waits on its
question, as the first start of this release leaves a waiting task.

The reviews of the #505 pull request ran these probes with an `e72f33fd`
build; `037b327a` has the same code. The first ran on stores with one native
session per task, before the mapping moved to one session per conversation:

- A store holding a succeeded native task was refused at 86,000 s after the
  last native change and recovered at 86,410 s, when that session had expired.
- A store holding a running native task was refused at 5 s and recovered after
  two days.
- A store holding a failed native task, a needs-owner native task and a running
  Claude session was refused.
- A store holding one succeeded and one needs-owner native session was refused
  at start and at 86,000 s, and recovered at 86,430 s.
- A store holding only a waiting native task opened cleanly and accepted a
  Claude observation.

A separate probe on 2026-11-21 let an `e72f33fd` build open stores this release
wrote with a succeeded native task. Beside a running Claude session, three
Claude observations were each refused `unavailable` (WARN). Beside a Claude
session whose turn had ended, the same three were each refused `internal`
(ERROR). In both, the start logged `operation.failed` `storage` `unavailable`,
and a session sync was answered `unavailable`.

The reviews of the reworked pull request reran the probes on stores with one
session per conversation, again against an `e72f33fd` runtime:

- A conversation whose earlier task succeeded and whose latest task waits on
  its question, beside a running Claude session: the start logged
  `operation.failed` `storage` `unavailable`, Claude observations were
  refused `unavailable` (WARN), and a session sync was answered
  `unavailable`.
- The same conversation, or one holding a cancelled or failed task's result,
  beside a Claude session whose turn had ended: Claude observations were
  refused `internal` (ERROR).
- Each such store recovered at 86,500 s after the last native change, when the
  conversation's session had expired.
- A store holding only a conversation whose task waits on its question, and
  one holding only a conversation whose task went uncertain, was resumed and
  was then interrupted, with no result and no running work, opened cleanly.
- The earlier release's validator refused the native record as
  `invalid-message` at `/identity/client`.

Prefer fixing forward. A return below this release needs, as a precondition,
that the core holds no native session:

1. End or cancel every conversation's unfinished assistant task in
   Conversation, then disable the conversation, which Conversation refuses
   while any conversation has an unfinished task. No new task can then start.
2. Wait a full day after the last task change in any profile's conversation.
   Expiry removes each native session a day after its last evidence.
3. Check that none is left: the `core_sessions` MCP tool with
   `{"provider": "bunny"}` returns an empty `sessions` list, as does the
   dashboard's session list filtered to the `bunny` provider. Only then stop
   the runtime and return.

No change in this release can make an older release accept a native record.
A later option, not built: an operator command in this release that retires
every native session at once through the ordinary retirement path, so that
step 2 needs no day's wait.

## Retired settings replication metadata

The runtime leaves existing history rows and the former settings metadata
columns and index in place. New history rows omit those fields. New stores
open without the retired metadata. Ordinary history keeps its origin, sequence
and span data. A configuration that still names `modules.core.peer` is refused
before opening state.

## Core history spans

The #1772 release adds the table `core_history_span` to the core store
(`modules/core.sqlite`), for every core store, the Mac container's state volume
included. At its first open, in the transaction that opens history, the core
creates the table empty. It adds no column, changes no row, index or other
table, and reads no history row, so the step costs the same on a store of any
size. Opening the store again changes nothing.

After the upgrade, a reading whose only change is a bookkeeping value updates
one small row of `core_history_span` and writes no history row and no
`core_history_latest`, with two exceptions: a reading of a polled family after
a silence longer than its gap writes a gap row and rewrites
`core_history_latest`, and a removal of an entity whose span holds more than its
row's reading writes one closing row before the removal row. A change writes one
history row and rewrites `core_history_latest`, as before, and also its span
row. Rows already stored stay as they are. The release does not measure the
effect on the store's growth; #1774 measures it after installation.

Returning to the previous release on a store this release opened works from
the code and focused tests: that release ignores `core_history_span`, starts,
and writes `core_history_latest` and a row for each changed reading as before,
in the same gapless order. Coming forward again, this release resets an
entity's span to an unknown start when the previous release took a reading of
that entity at a revision other than the span's row, and keeps counting from
there; it keeps the span of an entity that release took no reading of. It does not detect a row the previous release wrote at the revision
of the entity's last row when no reading with a higher revision reached that
release, which needs a publisher that republishes one revision with a different
value. In that case, when the first change, gap or closing row this release
writes for that entity afterwards carries a `span` member, two stored values in
it are wrong, `span.sinceAtMs` and `span.confirmations`: the start falls before the previous
release's row and the count leaves out its readings. That row's revision,
previous revision and changed members are right, so every record rebuilt from
rows is right and the order stays gapless; the span member stays wrong because
rows are never updated. This is not a qualified recovery, so recovery stays
unknown unless separately qualified; prefer fixing forward.

## Routine operation checklist

1. Verify reviewed merged source, applicable CI and release integrity. Assess
   actual stored-format changes and accept focused forward evidence.
2. Prepare a fresh request/operation ID, backup destination and read-only plan.
   Record recovery as unknown unless latest-state reader evidence is qualified.
   Review expected startup effects against existing authority.
3. Hold the operation lock, recheck the exact plan, persist intent, stop and
   verify writer exit, back up, select once and start.
4. Verify running identity/health, preserved latest state and final receipt.
   Retain releases and backup. A failure requires inspection, not blind replay.
5. Recover only if separately qualified in the plan and still valid for latest
   state. Otherwise retain the failed state and inspect a fix forward. Report
   source, installed, client and physical results separately.

## Inputs and authority

Keep the exact request, plan, release evidence, compatibility evidence, intent,
backup and final receipt private. Publish synthetic receipts only. Credentials
never belong in a receipt or command line, and personal state never belongs in
Git or a GitHub artifact.

Select one private installation root outside Git and Windows mounts. Its owned
layout is `releases/<full-sha>/`, `current`, `provenance/`, `receipts/`, `backups/`
and the persistent regular file `install.lock`. Keep mutable runtime state and
configuration at their existing external paths. The operator supplies their
actual paths; the procedure does not choose another installation or discover
another device.

The request names the following inputs:

- Previous and target release identities, manifests, archives and
  trusted source/build evidence. All revisions are full immutable SHAs.
- The existing runtime state directory, private configuration file, Node
  executable, service unit fragments and protected hook paths.
- The source comparison, applicable successful CI and a focused assessment of actual
  stored-format changes and evidence for the affected forward readers.
- The authenticated build-read credential file, loopback health origin,
  required module health and any specifically accepted existing exception.
- The exact backup and independently stated latest-state recovery eligibility, including bounds and
  the expected startup effects of the selected modules.

Standing installation authority covers the established installation's
qualified routine upgrades. First adoption of the release anchor needs an
explicitly approved plan for its one-time service override and restart effects.
A new host, permission, hook, configuration, module activation or device command
needs its own applicable authority. Do not add such effects to an upgrade.

Apply [Parallel delivery](../../docs/sdlc.md#parallel-delivery) to coordination.
Reserve only the installed operation or test baseline that must remain stable;
record the affected resources and release condition in existing private evidence.
Keep runtime, device and camera needs separate. Waiting for physical input does
not reserve unrelated resources or prevent source preparation in other worktrees.
An actual upgrade still holds the operation lock through final readback. A physical
test that needs a stable installed revision must finish or be explicitly handed
off before an upgrade changes that baseline. A recorded release plus current
state verification needs no second acknowledgment and grants no new device authority.

## Release and recovery proof

Prepare each new release from its reviewed merged revision in an isolated clean
checkout. Refresh main and verify the applicable merged-revision CI first. Use
Node from that revision's `.nvmrc`, then run `npm ci` and `npm run build` from the
release checkout. Keep the lockfile and complete shipped dependencies with the
release. Never rebuild the checkout used by the running service.

Use the following commands from the new clean release checkout, with
`BUNNY_SOURCE_REVISION` set to the selected full merged SHA. Retain the successful
CI readback and build command/result separately. The local ancestry check uses a
fresh `origin/main`; it does not replace CI or independent review.

<!-- qualification: release-build -->
```bash
(
set -euo pipefail
git fetch origin main
test "$(git rev-parse HEAD)" = "$BUNNY_SOURCE_REVISION"
test -z "$(git status --porcelain --untracked-files=all)"
git merge-base --is-ancestor "$BUNNY_SOURCE_REVISION" origin/main
fnm exec --using=.nvmrc -- npm ci
fnm exec --using=.nvmrc -- npm run build
test -z "$(git status --porcelain --untracked-files=all)"
)
```

Package into a new `BUNNY_BUNDLE_DIRECTORY` whose parent is already private and
outside Git and Windows mounts. This block takes tracked source from that SHA,
then copies the actual built workspace payloads and complete dependencies. It
creates no installation anchor and changes no service. It refuses a reused
bundle, dirty checkout, wrong build identity or unsupported workspace layout.
The existing fixed workspace list is used without wildcard discovery. Keep the
source archive, manifest, final archive and identity together with the build/CI
provenance; their hashes alone do not certify the producer.

<!-- qualification: release-package -->
```bash
fnm exec --using=.nvmrc -- node --input-type=module - "$BUNNY_SOURCE_REVISION" "$BUNNY_BUNDLE_DIRECTORY" <<'JS'
import {execFileSync} from 'node:child_process';
import {lstat, mkdir, open, readFile, realpath} from 'node:fs/promises';
import {dirname, join, resolve} from 'node:path';
import {canonical, fullRevision, hashRegular, inventory, safeRelative, sha256} from './apps/hub/dist/install/files.js';
import {syncDirectory} from './apps/hub/dist/install/stage.js';
import {checkStateDirectory} from './apps/runtime/dist/src/state.js';
const [revision, bundle] = process.argv.slice(2);
process.umask(0o077);
const git = (...args) => execFileSync('git', args, {encoding: 'utf8'}).trim();
const archiveEnvironment = {...process.env, TAR_OPTIONS: ''};
if (!fullRevision(revision) || git('rev-parse', 'HEAD') !== revision
  || git('status', '--porcelain', '--untracked-files=all') !== '') throw new Error('release-build-refused');
execFileSync('git', ['merge-base', '--is-ancestor', revision, 'origin/main']);
if (typeof bundle !== 'string' || resolve(bundle) !== bundle) throw new Error('release-path-refused');
await checkStateDirectory(dirname(bundle));
const source = await realpath('.');
const rootPackage = JSON.parse(await readFile('package.json', 'utf8'));
const version = JSON.parse(await readFile('apps/runtime/package.json', 'utf8')).version;
const stampSource = await readFile('apps/runtime/dist/src/build-identity.js', 'utf8');
const prefix = 'export const BUILD_IDENTITY = Object.freeze(', suffix = ');\n';
if (!stampSource.startsWith(prefix) || !stampSource.endsWith(suffix)) throw new Error('release-build-refused');
const stamp = JSON.parse(stampSource.slice(prefix.length, -suffix.length));
if (stamp.schema !== 'runtime-build/2.0' || stamp.revision !== revision || stamp.dirty !== false
  || stamp.version !== version) throw new Error('release-build-refused');
const workspaces = rootPackage.workspaces;
if (!Array.isArray(workspaces) || workspaces.length === 0 || workspaces.length > 64
  || workspaces.some(path => typeof path !== 'string' || !safeRelative(path) || /[*?\[\]\r\n]/.test(path))
  || new Set(workspaces).size !== workspaces.length) throw new Error('release-workspaces-refused');
for (const path of workspaces) {
  if (await realpath(path) !== join(source, path) || !(await lstat(path)).isDirectory()) throw new Error('release-workspaces-refused');
}
await mkdir(bundle, {mode: 0o700});
await checkStateDirectory(bundle);
const release = join(bundle, 'release'), provenance = join(bundle, 'provenance');
await mkdir(release, {mode: 0o700}); await mkdir(provenance, {mode: 0o700});
execFileSync('git', ['archive', '--format=tar', '--output', join(provenance, 'source.tar'), revision]);
execFileSync('tar', ['--extract', '--no-same-owner', '--file', join(provenance, 'source.tar'), '--directory', release], {env: archiveEnvironment});
const copy = async (path, required) => {
  let info;
  try { info = await lstat(path); } catch (error) { if (error.code !== 'ENOENT' || required) throw error; return; }
  if (!info.isDirectory() || info.isSymbolicLink()) throw new Error('release-payload-refused');
  execFileSync('cp', ['-a', '--no-preserve=links', '--', path, join(release, path)]);
};
await copy('node_modules', true);
for (const workspace of workspaces) {
  await copy(join(workspace, 'dist'), false);
  await copy(join(workspace, 'node_modules'), false);
}
const manifest = {artifact: '@jimmie-potts/runtime', sourceRevision: revision, version,
  inventory: (await inventory(release)).entries};
const save = async (path, value) => {
  const file = await open(path, 'wx', 0o600);
  try { await file.writeFile(canonical(value) + '\n'); await file.sync(); } finally { await file.close(); }
  await syncDirectory(dirname(path));
};
await save(join(release, 'manifest.json'), manifest);
const archive = join(provenance, 'release.tar.gz');
execFileSync('tar', ['--create', '--gzip', '--hard-dereference', '--file', archive, '--directory', release, '.'], {env: archiveEnvironment});
// The private parent protects payload files; identity/archive themselves are owner-only.
execFileSync('chmod', ['600', archive, join(provenance, 'source.tar')]);
execFileSync('sync', ['--', archive, join(provenance, 'source.tar')]);
const identity = {kind: 'release', sourceRevision: revision, version,
  archiveSha256: await hashRegular(archive), manifestSha256: sha256(await readFile(join(release, 'manifest.json')))};
await save(join(provenance, 'identity.json'), identity);
await syncDirectory(provenance);
await syncDirectory(bundle);
await syncDirectory(dirname(bundle));
if (git('status', '--porcelain', '--untracked-files=all') !== '') throw new Error('release-build-refused');
JS
```

Candidate packaging copies regular-file aliases as separate files with identical
bytes, because the reused inventory verifier requires single-link files. It
preserves internal relative symbolic links. This packaging choice does not alter
the actual installed baseline or its separately retained alias-aware closure.
The inventory check rejects links escaping the staged tree. Preserve failed or
partial bundles as evidence and choose a fresh destination after inspection;
do not overwrite an existing SHA or reuse a failed artifact. Verify this staged
release with the command below before extraction. This archive is locally
produced from those inventoried bytes, not an untrusted third-party archive.

Retain the source/build evidence and a complete manifest of payload names,
types, modes, content hashes and internal relative link targets. Bind the
manifest and archive hashes to the exact revision and package version. Refuse
unsafe names, links outside the release, unsupported entry types, tampering or
a different payload under an already retained SHA. Extract only a verified,
owned archive into a new private directory, then verify the extracted inventory.
Hash agreement is not proof that the producer used clean merged source.

For the locally produced archive above, verify the staged release first. Then
extract its exact pinned bytes into a new `BUNNY_EXTRACT_DIRECTORY` under an
already qualified private parent. This command does not accept arbitrary archives:
the reviewed build/provenance must bind the inventoried producer and identity.
It uses the host's archive utility, not the retained legacy Hub extractor, whose
artifact layout and size limits differ from this runtime bundle.

<!-- qualification: release-extract -->
```bash
(
set -euo pipefail
node apps/runtime/bin/runtime-upgrade-check.mjs verify-release "$BUNNY_IDENTITY_FILE" "$BUNNY_RELEASE_DIRECTORY" "$BUNNY_ARCHIVE_FILE"
node --input-type=module - "$BUNNY_IDENTITY_FILE" "$BUNNY_ARCHIVE_FILE" "$BUNNY_EXTRACT_DIRECTORY" <<'JS'
import {execFileSync} from 'node:child_process';
import {constants} from 'node:fs';
import {mkdir, open} from 'node:fs/promises';
import {dirname, join, resolve} from 'node:path';
import {inventory, sha256} from './apps/hub/dist/install/files.js';
import {syncDirectory} from './apps/hub/dist/install/stage.js';
import {checkStateDirectory, readPrivateFile} from './apps/runtime/dist/src/state.js';
const [identityFile, archiveFile, destination] = process.argv.slice(2);
const identity = JSON.parse((await readPrivateFile(identityFile, 256 * 1024)).toString('utf8'));
const bytes = await readPrivateFile(archiveFile, 256 * 1024 * 1024);
if (sha256(bytes) !== identity.archiveSha256 || resolve(destination) !== destination) throw new Error('release-extract-refused');
await checkStateDirectory(dirname(destination));
await mkdir(destination, {mode: 0o700});
await checkStateDirectory(destination);
// Feed the bytes just verified; a later pathname replacement cannot select another archive.
execFileSync('tar', ['--extract', '--gzip', '--no-same-owner', '--same-permissions', '--keep-old-files',
  '--file=-', '--directory', destination], {input: bytes, env: {...process.env, TAR_OPTIONS: ''}});
// Persist every extracted regular file, then directory entries from leaves to root.
const entries = (await inventory(destination)).entries;
for (const entry of entries.filter(entry => entry.kind === 'file')) {
  const file = await open(join(destination, entry.path), constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try { await file.sync(); } finally { await file.close(); }
}
for (const entry of entries.filter(entry => entry.kind === 'directory').sort((a, b) => b.path.split('/').length - a.path.split('/').length)) {
  await syncDirectory(join(destination, entry.path));
}
await syncDirectory(destination); await syncDirectory(dirname(destination));
JS
node apps/runtime/bin/runtime-upgrade-check.mjs verify-release "$BUNNY_IDENTITY_FILE" "$BUNNY_EXTRACT_DIRECTORY" "$BUNNY_ARCHIVE_FILE"
)
```

Retain a failed extraction directory for inspection. A successful extraction
requires the final complete inventory check; a successful archive command alone
is insufficient. An existing directory refuses, preserving its contents. The
extraction changes no selected release, mutable runtime state or service.

After the root build, verify a supplied release with:

```bash
node apps/runtime/bin/runtime-upgrade-check.mjs verify-release "$BUNNY_IDENTITY_FILE" "$BUNNY_RELEASE_DIRECTORY" "$BUNNY_ARCHIVE_FILE"
```

This command reads files and verifies supplied hashes; it changes no service,
release selection or runtime state. Retain its result alongside the trusted
source/build and extraction evidence.

## Focused change assessment and request

Compare the reviewed release change with the installation's configuration and
known retained owners. Record affected storage formats/readers and focused
forward write/reopen evidence when those paths change. Unchanged owners need no
new phase receipts. Preserve inactive files and permanent referenced media;
never open live SQLite databases merely to inventory them. Source fingerprint
equality is not a semantic compatibility verdict. Historical `verify-formats`
and certificate readers remain optional evidence tools, outside routine admission.

Prepare a new private `runtime-upgrade-request/2.0` JSON document with exactly:

- `schema`, `operation` (`upgrade`, or separately authorized first `adoption`),
  `installationId`, `installationRoot`, `tokenFile`.
- `releases`: `previous` and `target`, each `{identity, directory, archive}`
  naming verified private artifact paths. No mandatory third release.
- `installedBaselineClosure`: `{path, sha256}` for the established
  `runtime-installed-closure/2.0` record, including Node, units and protected
  hook completeness. Preserve actual built bytes/timestamp and independently
  verify this executable/dependency closure. A revision string is insufficient.
- `changeAssessment`: private `{path, sha256}` under provenance. Name the exact
  previous/target comparison, actual affected storage and forward evidence;
  explicitly state unchanged/inactive paths and preservation. The coordinator
  reviews meaning. Hash pins establish unchanged bytes, not compatibility.
- `recovery`: `null` means unknown. To qualify recovery use
  `{release: {identity, directory, archive}, evidence: {path, sha256}}`, with
  `release` exactly equal to `releases.previous`. Recovery under this operation
  must use that same verified artifact and complete identity so receipt 1.0 can
  truthfully record its result. A different release needs a separately assessed
  operation; do not change the original intent's previous identity. Evidence
  stays private under provenance and binds the exact release, current config,
  selected owners and latest-state write/reopen proof for affected formats. A
  certificate from a different build or same-source restart test cannot substitute.
- `execution`: the bounded operation frame described below.

Request/plan 1.0 is superseded and refuses new execution. Recreate a fresh request
and review plan 2.0; do not edit an old approval or receipt. Receipt schema 1.0
and historical interrupted-operation resolution remain supported. Record
the forward assessment in receipt `compatibility.evidence`, using
`compatibility.status: "compatible"` only for the reviewed forward path. The
approval pins plan 2.0, whose `recovery: null` records unknown recovery; do not
add fields to receipt 1.0 or claim a downgrade guarantee. `rollback.status` stays
`not-attempted` unless an actual qualified recovery was observed. Use the existing
receipt validation contract. The same private file may hold the change and startup
assessment; no extra dossier is required.

Protect hook paths and resolved producers outside installation storage. Obtain
the complete hook list from accepted installation evidence; no guessed client
configuration or silent hook retargeting. The existing readers verify exact
bytes and resolutions. An empty list still needs accepted completeness evidence.

Configured modules require running, healthy, null-reason health. Unconfigured
Art, Wispr, BB-8, ONN, Roborock, Wemo, Weather and Volcano may report only the exact absent-module
`refused`/`not-found`/`healthy: false` row and corresponding degraded aggregate.
Retained inactive files do not convert absence into healthy active ownership.
Unknown owners and unsafe files still refuse. The always-started companions
owner needs release-specific ordinary health and its private primary store;
only that first-created owner may be added after startup.

## Plan and hold the operation lock

Capture the exact read-only preflight plan. Review its installed identity,
running process/build identity, target, change assessment, protected paths,
configuration, backup, recovery and expected effects. Retain the canonical plan
and digest privately. A missing observation is a refusal, not a matching baseline.

The request's required `execution` object binds the neutral `operationId` and
`backupDirectory` (`<installationRoot>/backups/<operationId>`), `stopTimeoutMs`
(1–60 seconds), and `postStart` limits: `attempts` (1–30), `timeoutMs` (1–180
seconds), and `intervalMs` (100–10,000 milliseconds, less than the timeout).
`startupEffects.assessment` and `startupEffects.authority` are private
`{path, sha256}` evidence pins under provenance. A valid pin establishes unchanged
bytes; the coordinator must inspect and accept their meaning before effects.

For an upgrade, `execution.adoption` is `null`. For first adoption it names
`draftFile`, `overrideFile`, private retained `originals` pins, and a private
`restoration` evidence pin. The new override must be in the observed primary
unit's `bunny-runtime.service.d` directory, which must remain absent before the
operation. The plan derives the draft's exact bytes and digest from the observed
invocation. Preparing those same bytes at the named provenance path preserves
the plan; different draft bytes refuse. All operational choices and evidence
are compared again by the locked recheck.

Choose the post-start bound for the complete verification attempt before stopping
the service. It includes repeated release inventories and protected-input checks,
as well as the separately bounded HTTP reads. Use read-only release checks on the
actual artifacts to size it; small synthetic fixtures do not establish installed
verification time. Changing the selected bound requires a fresh plan and its
applicable authority. Only observations are retried; service or device effects
are not repeated to make verification pass.

Set the manual command variables from this inspected plan. In particular,
`BUNNY_BACKUP_DIRECTORY` is `execution.backupDirectory`, and
`BUNNY_STOP_TIMEOUT_SECONDS` is `execution.stopTimeoutMs / 1000`. For adoption,
use its exact draft and override paths; derive the override directory with
`dirname`. Do not choose different destinations or bounds after approval.

After building the reviewed source, save the initial plan in the qualified
private provenance directory. Use a new filename; never overwrite a reviewed
plan. The command reads the named service, fixed loopback endpoints and qualified
files. It sends no device command and changes no service or release selection.

```bash
(umask 077; set -C; node apps/runtime/bin/runtime-upgrade-check.mjs plan "$BUNNY_REQUEST_FILE" > "$BUNNY_INSTALL_ROOT/provenance/plan.json")
```

Each preflight or running check creates one operation trace and propagates its
context to both loopback HTTP reads. The existing bounded tracing adapter writes
operation spans to private stderr, including the selected operation ID. Retain
that diagnostic output privately; it contains no token or credential contents.
Random trace IDs stay outside the canonical plan and its digest. Diagnostic
failure does not change the observation result.

Require exit zero and inspect the complete private plan. A failed command may
leave an incomplete file; retain it as failed evidence and do not use it. The
preflight binds the focused assessment, optional recovery and current
baseline/hook protection. It pins configuration, credentials and read-token
hashes without their contents; keep all of these private. It does not interpret
operator evidence as approval or establish actual-client/physical acceptance.

During initial qualified setup, create `install.lock` once as an owned regular
file with mode 600. Creation must refuse an existing path. Never delete,
truncate or replace this file to clear a lock. The installation root and operation
directories must already be owned private directories without path links.

Perform the operation in one shell. Open the existing lock read-only and obtain
its exclusive lock before rechecking any approved input:

```bash
exec 9<"$BUNNY_INSTALL_ROOT/install.lock" || exit "$?"
flock -n -E 75 9 || exit "$?"
node apps/runtime/bin/runtime-upgrade-check.mjs check-lock "$BUNNY_INSTALL_ROOT" || exit "$?"
```

Stop if any command fails. Keep that descriptor and shell alive through
preflight, intent, stop, backup, selection, start, verification, any recovery and
final receipt readback. The locked recheck must verify that descriptor 9 and the
checked lock path name the same owned regular-file device/inode. A competing lock,
replaced path or unresolved earlier intent refuses before service effects.
`check-lock` verifies the inherited descriptor's identity and private file
properties. It does not acquire a lock or prove that `flock` succeeded; the
manual shell must stop on a failed acquisition and retain the descriptor.

Recompute the approved plan while locked. Configuration, protected paths,
selected release, running process/start identity, source evidence or assessment/recovery
evidence drift requires a fresh plan. Ordinary changes to counters or durable
record contents do not justify treating state as unchanged; they are handled by
the stopped-writer backup and focused latest-state evidence.

```bash
node apps/runtime/bin/runtime-upgrade-check.mjs recheck "$BUNNY_REQUEST_FILE" "$BUNNY_INSTALL_ROOT/provenance/plan.json"
```

Require exit zero before writing intent or stopping the writer. This recollects
the original process/listener, build/health and all source/assessment/baseline,
hook, state and receipt bindings. The result must equal the reviewed plan. FD9
must match the persistent lock before and after collection; the manual shell
still owns successful `flock` acquisition. A plan file alone authorizes no
first-adoption override or other effect outside standing installation authority.

Write the schema-valid in-progress receipt and require successful durable readback
before stopping the runtime:

Use a new `BUNNY_RECEIPT_DIAGNOSTIC_FILE` in the private operation-evidence
directory for each invocation. Do not use a journal, CI log or public artifact.
The file must not already exist; the command refuses to overwrite it.

```bash
(
set -euo pipefail
umask 077
set -o noclobber
test ! -e "$BUNNY_RECEIPT_DIAGNOSTIC_FILE"
test ! -L "$BUNNY_RECEIPT_DIAGNOSTIC_FILE"
node apps/runtime/bin/runtime-upgrade-check.mjs receipt "$BUNNY_INTENT_FILE" "$BUNNY_RECEIPTS_DIRECTORY" 2> "$BUNNY_RECEIPT_DIAGNOSTIC_FILE"
)
```

The receipt writer validates and persists the supplied document. It does not
prove that the host performed the described operation. Finalization preserves
the original operation, release, approval and compatibility frame. An identical
receipt is synchronized and read back again before `persisted: true`; visible
bytes from an earlier failed synchronization do not establish durability.

## Stop, back up, select and verify

Control only the named user service:

```bash
timeout "${BUNNY_STOP_TIMEOUT_SECONDS}s" systemctl --user stop bunny-runtime.service
```

Within the approved bound, verify that its owner and children have exited and
its cgroup is empty. An inactive status alone does not prove this. If a writer
remains, do not copy databases or switch the release. Record the failure and
leave recovery pending inspection.

Use the PID and cgroup from the locked plan, captured before stop. The following
check uses those exact values; it does not select a process from its name. Set
`BUNNY_OLD_PID` and `BUNNY_OLD_CGROUP` from that plan. The latter is the full path
under `/sys/fs/cgroup` for its recorded `controlGroup`. Stop on a failed check.
If the cgroup still exists, `populated 0` covers its descendants too. A removed
cgroup has no remaining members. Do not kill an unrelated process to clear a
failure or assume that a service-manager timeout means the stop succeeded.

<!-- qualification: stopped-writer -->
```bash
(
set -euo pipefail
test "$(systemctl --user show --value --property=MainPID bunny-runtime.service)" = 0
test "$(systemctl --user show --value --property=ActiveState bunny-runtime.service)" = inactive
test ! -e "/proc/$BUNNY_OLD_PID"
if test -e "$BUNNY_OLD_CGROUP"; then
  grep -Fxq 'populated 0' "$BUNNY_OLD_CGROUP/cgroup.events"
fi
)
```

With all named writers stopped, back up the complete named state and
configuration into a new owned private backup directory. Include SQLite WAL or
journal files where present, permanent originals and references; omit sockets
and transient process objects. Verify the backup inventory and retain its hash
in the receipt. Do not open a second live SQLite owner, copy only the main
SQLite file from a running writer or transfer state to another installation.

The current state inspector accepts the `modules` directory, the two optional
span files and `bunny-launch.sock`. Copy the durable entries explicitly; omit
only that socket. The module tree includes every database sidecar, lease file,
media original and reference. Use a new `BUNNY_BACKUP_DIRECTORY` under the
approved root's `backups/`; it must not already exist. Set `BUNNY_STATE_DIRECTORY`
and `BUNNY_CONFIG_FILE` from the plan, rather than a different installation.
Keep all output from these commands private. The type/ownership check refuses
links and unsupported objects in the module tree before copying. A refusal
leaves its new backup directory for inspection and does not select a release.

<!-- qualification: stopped-backup -->
```bash
(
set -euo pipefail
umask 077
test ! -e "$BUNNY_BACKUP_DIRECTORY"
test ! -L "$BUNNY_BACKUP_DIRECTORY"
mkdir -m 700 -- "$BUNNY_BACKUP_DIRECTORY"
mkdir -m 700 -- "$BUNNY_BACKUP_DIRECTORY/state"
find -P "$BUNNY_STATE_DIRECTORY/modules" \( -type l -o \( ! -type f -a ! -type d \) -o ! -uid "$(id -u)" -o -perm /0077 \) -print -quit > "$BUNNY_BACKUP_DIRECTORY/unsupported-entries.txt"
test ! -s "$BUNNY_BACKUP_DIRECTORY/unsupported-entries.txt"
cp -a -- "$BUNNY_STATE_DIRECTORY/modules" "$BUNNY_BACKUP_DIRECTORY/state/"
diff --recursive --brief --no-dereference -- "$BUNNY_STATE_DIRECTORY/modules" "$BUNNY_BACKUP_DIRECTORY/state/modules"
for BUNNY_SPAN_FILE in spans.ndjson spans.previous.ndjson; do
  if test -e "$BUNNY_STATE_DIRECTORY/$BUNNY_SPAN_FILE"; then
    cp --preserve=mode,timestamps --no-dereference -- "$BUNNY_STATE_DIRECTORY/$BUNNY_SPAN_FILE" "$BUNNY_BACKUP_DIRECTORY/state/$BUNNY_SPAN_FILE"
    cmp -- "$BUNNY_STATE_DIRECTORY/$BUNNY_SPAN_FILE" "$BUNNY_BACKUP_DIRECTORY/state/$BUNNY_SPAN_FILE"
  fi
done
cp --preserve=mode,timestamps --no-dereference -- "$BUNNY_CONFIG_FILE" "$BUNNY_BACKUP_DIRECTORY/runtime.json"
cmp -- "$BUNNY_CONFIG_FILE" "$BUNNY_BACKUP_DIRECTORY/runtime.json"
env -u TAR_OPTIONS /usr/bin/tar --create --file="$BUNNY_BACKUP_DIRECTORY/backup.tar" --directory="$BUNNY_BACKUP_DIRECTORY" state runtime.json
sha256sum -- "$BUNNY_BACKUP_DIRECTORY/backup.tar" > "$BUNNY_BACKUP_DIRECTORY/backup.sha256"
sync -- "$BUNNY_BACKUP_DIRECTORY/backup.tar" "$BUNNY_BACKUP_DIRECTORY/backup.sha256" "$BUNNY_BACKUP_DIRECTORY" "$(dirname -- "$BUNNY_BACKUP_DIRECTORY")"
sha256sum --check --status -- "$BUNNY_BACKUP_DIRECTORY/backup.sha256"
)
```

Require every command to exit zero in the held operation shell. The archive's
hash is the receipt's backup digest; retain the copied tree and comparison
results as its consistency evidence. Verify free space for the named state and
backup before stopping. These commands refuse links rather than follow an
unqualified external store. An unknown layout needs qualification, not an
exclusion. Credential and read-token files remain at their pinned external
paths; recovery does not replace them with archived values.

Publish the verified target through an atomic replacement of the owned `current`
link. Verify the exact previous and target releases again. Verify a recovery
artifact only when the approved plan contains one. Routine
upgrades do not rewrite service units, configuration or hooks.

From the reviewed helper checkout, use the existing filesystem publication
primitive below. It creates a temporary link beside `current`, renames it over
the anchor, fsyncs the installation root and verifies the resulting target.
It invokes no installer or service. `BUNNY_SELECTION_DIRECTORY` must be the
verified target directory from the locked request. Before this command, repeat
`verify-release` for the exact previous and target artifacts, and for recovery
only when it is qualified in the approved plan. If recovery is null, no third
artifact is required. Confirm the current link still has the plan's original target (or remains absent
for initial adoption). A different anchor requires inspection and a new plan.

<!-- qualification: select-release -->
```bash
node --input-type=module - "$BUNNY_INSTALL_ROOT" "$BUNNY_SELECTION_DIRECTORY" <<'JS'
import {readlink, realpath} from 'node:fs/promises';
import {join} from 'node:path';
import {switchCurrent} from './apps/hub/dist/install/stage.js';
const [root, target] = process.argv.slice(2);
if (!target.startsWith(root + '/releases/') || !/^[a-f0-9]{40}$/.test(target.slice((root + '/releases/').length))) throw new Error('runtime-selection-refused');
await switchCurrent(root, target);
if (await readlink(join(root, 'current')) !== target || await realpath(join(root, 'current')) !== target) throw new Error('runtime-selection-readback');
JS
```

A nonzero selection exit does not prove that the anchor stayed unchanged. The
rename can succeed before directory synchronization or readback fails. Inspect
the exact link, selected release and writer state before choosing an outcome or
recovery. Do not start the candidate, repeat selection blindly or record
`failed-before-switch` merely because this command failed. Retain the intent and
failed evidence until inspection establishes what happened. If the anchor
changed, use one explicitly selected qualified recovery; successful recovery
records `failed-rolled-back` with failure phase `switch` and the observed previous
identity. An unresolved selection remains interrupted.

Start the same service:

```bash
systemctl --user start bunny-runtime.service
```

Within the approved bound, verify a new owner process and start identity, its
Node executable and entry, the startup-scoped `GET /api/v2/build` revision and
version, and `GET /api/runtime/v1/health` for required module health. Use the
existing private read credential in memory for authenticated reads; do not put
it in arguments, receipts or logs. Recheck process identity around the reads.
An active service, selected link or healthy HTTP listener alone is insufficient.
An accepted health exception must match its named owner and evidence; it cannot
cover a new failure.

Use `verify-running` for those reads. It binds the approved request and plan,
checks the selected target or recovery release, preserves Node, arguments,
configuration, credentials, hooks and original unit bytes, and checks the
authenticated build and module health around repeated owner/listener reads.
For first adoption it also checks the exact added override. It inspects retained
state owners and layout without opening live databases; content retention still
requires the separately qualified latest-state evidence.

Run the following block in the shell holding FD9. Set `BUNNY_CHECK_PHASE` to
`candidate`, `recovery` or `reupgrade` for the start just performed. Each phase
creates a new private evidence directory; an existing directory requires
inspection before selecting any new evidence location. The block derives its
attempt, per-attempt timeout and interval from the approved frame. Only
observations are retried. It never starts, stops or switches a service.

<!-- qualification: verify-running -->
```bash
(
set -euo pipefail
umask 077
case "$BUNNY_CHECK_PHASE" in candidate|recovery|reupgrade) ;; *) exit 1 ;; esac
BUNNY_CHECK_FRAME="$(node --input-type=module - "$BUNNY_REQUEST_FILE" "$BUNNY_PLAN_FILE" "$BUNNY_INSTALL_ROOT" <<'JS'
import {readPrivateFile} from './apps/runtime/dist/src/state.js';
import {parseUpgradeRequest} from './apps/runtime/dist/src/upgrade-paths.js';
import {canonical, sha256} from './apps/hub/dist/install/files.js';
const [requestFile, planFile, root] = process.argv.slice(2);
const bytes = await readPrivateFile(requestFile, 256 * 1024);
const request = parseUpgradeRequest(JSON.parse(bytes.toString('utf8')));
const {planSha256, ...plan} = JSON.parse((await readPrivateFile(planFile, 256 * 1024)).toString('utf8'));
if (request.installationRoot !== root || sha256(bytes) !== plan.requestSha256 || sha256(canonical(plan)) !== planSha256 || canonical(request.execution) !== canonical(plan.execution)) throw new Error('runtime-upgrade-running-refused');
const {attempts, timeoutMs, intervalMs} = request.execution.postStart;
process.stdout.write([attempts, timeoutMs / 1000, intervalMs / 1000, request.execution.operationId].join(' '));
JS
)"
read -r BUNNY_CHECK_ATTEMPTS BUNNY_CHECK_TIMEOUT_SECONDS BUNNY_CHECK_INTERVAL_SECONDS BUNNY_CHECK_OPERATION <<< "$BUNNY_CHECK_FRAME"
BUNNY_CHECK_EVIDENCE_DIRECTORY="$BUNNY_INSTALL_ROOT/provenance/running-$BUNNY_CHECK_OPERATION-$BUNNY_CHECK_PHASE"
mkdir -m 700 -- "$BUNNY_CHECK_EVIDENCE_DIRECTORY"
for ((BUNNY_CHECK_ATTEMPT=1; BUNNY_CHECK_ATTEMPT<=BUNNY_CHECK_ATTEMPTS; BUNNY_CHECK_ATTEMPT++)); do
  if /usr/bin/timeout --signal=KILL "${BUNNY_CHECK_TIMEOUT_SECONDS}s" node apps/runtime/bin/runtime-upgrade-check.mjs verify-running "$BUNNY_REQUEST_FILE" "$BUNNY_PLAN_FILE" "$BUNNY_CHECK_PHASE" > "$BUNNY_CHECK_EVIDENCE_DIRECTORY/attempt-$BUNNY_CHECK_ATTEMPT.json" 2> "$BUNNY_CHECK_EVIDENCE_DIRECTORY/attempt-$BUNNY_CHECK_ATTEMPT.stderr"; then
    exit 0
  else
    BUNNY_CHECK_EXIT=$?
    printf '%s\n' "$BUNNY_CHECK_EXIT" > "$BUNNY_CHECK_EVIDENCE_DIRECTORY/attempt-$BUNNY_CHECK_ATTEMPT.exit"
  fi
  if ((BUNNY_CHECK_ATTEMPT<BUNNY_CHECK_ATTEMPTS)); then /usr/bin/sleep "$BUNNY_CHECK_INTERVAL_SECONDS"; fi
done
exit 1
)
```

An exhausted bound is a verification failure. Retain every attempt and record
the supported failed or uncertain outcome before the qualified manual recovery
step. A killed attempt may leave an empty observation file; it is not a successful
read. Successful running checks do not establish client or physical acceptance.

Verify retained latest-state evidence and any applicable installed-client or
physical acceptance separately. Do not send device commands merely to make an
upgrade health check pass.

## Recover and finalize

If selection, startup or candidate verification fails, inspect the observed state.
If `plan.recovery` is null, do not select an older release: preserve the failed
latest state and intent and assess a fix forward. Record an interrupted handoff
when effects remain unresolved. Snapshot restoration needs the separate explicit
decision described above. Otherwise follow only the named qualified recovery sequence while retaining the same lock. Stop and verify
writer exit, select the verified previous release atomically and start the same
service on the **latest durable state**. Verify its process/build identity,
health and retained state again. Do not restore an older backup automatically,
repeat an uncertain device action or activate an omitted module. A failed recovery
remains a failed or interrupted operation with its evidence retained.

Before a recovery stop or selection, hold FD9 and require this read-only guard
to exit zero. It rechecks source/evidence, protected paths/configuration/credentials,
baseline Node/units/hooks and retained owner layout without requiring a healthy
candidate. It accepts only the approved inventory, optionally plus the planned
first-created companions owner; unexplained drift refuses before effects:

```bash
node apps/runtime/bin/runtime-upgrade-check.mjs check-recovery "$BUNNY_REQUEST_FILE" "$BUNNY_PLAN_FILE"
```

Then use the same stopped-writer checks and selection command, setting
`BUNNY_SELECTION_DIRECTORY` to the verified original previous release from the approved
request. Leave the state directory in place. Do not copy the backup over it.
Make one selected recovery attempt; a failure requires inspection, not another
automatic switch or start. In a successful recovery, the receipt records
`failed-rolled-back` with the observed previous identity. If it cannot establish
that identity and health, record `rollback-failed` or `interrupted` as applicable.

Choose the final outcome from retained observations, not the exit code alone.
The receipt helper validates and persists the document; it does not establish
that its described operation occurred.

| Observed failure | Outcome and evidence |
| --- | --- |
| Stop, writer-exit or backup failed; inspection proves no selection occurred | `failed-before-switch`; record the actual phase and retain the failed checks. Do not claim a verified running identity or health. |
| Selection failed before replacement and the original anchor is verified | `failed-before-switch` with phase `switch`; retain the anchor inspection. |
| Selection changed the anchor, or candidate start/health failed; one recovery verifies the previous release | `failed-rolled-back`; preserve the original failure phase, verified recovery identity/health and latest-state evidence. |
| The selected recovery cannot verify startup or health | `rollback-failed`; record phase `rollback`, keep running identity unverified and retain the recovery checks. |
| Effects or selection remain unresolved after interruption | `interrupted`; retain the intent and inspection handoff. Do not retry service or device effects. |
| Final receipt synchronization or readback failed | `receipt-finalization-failed` diagnostic when valid; inspect the durable receipt and retain both inputs before retrying persistence. |

Prepare `BUNNY_FINAL_RECEIPT_FILE` without replacing the original private intent
input. It must match the observed running identity, health, backup, state and
recovery result. Select a new `BUNNY_RECEIPT_DIAGNOSTIC_FILE`, distinct from the
intent command's diagnostic file, then finalize:

```bash
(
set -euo pipefail
umask 077
set -o noclobber
test ! -e "$BUNNY_RECEIPT_DIAGNOSTIC_FILE"
test ! -L "$BUNNY_RECEIPT_DIAGNOSTIC_FILE"
node apps/runtime/bin/runtime-upgrade-check.mjs receipt "$BUNNY_FINAL_RECEIPT_FILE" "$BUNNY_RECEIPTS_DIRECTORY" 2> "$BUNNY_RECEIPT_DIAGNOSTIC_FILE"
)
```

A persistence failure exits nonzero and, when its validated fields permit it,
emits the attempted schema-valid `receipt-finalization-failed` document to that
private stderr file. Otherwise it emits only a fixed refusal code. The diagnostic
is not proof that the durable receipt changed. Rename may already be visible
when synchronization or readback fails; inspect the actual receipt, selected
link, processes and latest state before any recovery. Retain both receipt inputs,
the diagnostic and all recovery references. Retrying receipt persistence sends
no service or device command; never repeat the upgrade itself blindly.

Do not claim success if finalization fails after a healthy start. Release the
descriptor only after final readback or a recorded interrupted handoff:

```bash
exec 9<&-
```

Retain all owned releases and recovery evidence for this initial procedure;
there is no pruning step. An interruption releasing the lock does not resolve
its intent. The next operation must inspect that intent before any effects.

### Settle an interrupted receipt

Hold the same installation lock while inspecting the unresolved receipt, its
approved plan, the selected link, running identity and health, and the latest
retained state. A named coordinator must decide what those observations establish
and retain that decision privately. The resolver checks hashes and document
consistency; it does not establish the meaning or accuracy of those observations.
Do not use it to turn missing installed evidence into a successful outcome.

Prepare a separate schema-valid final receipt for the same operation. Preserve
its original approval, source identities, compatibility decision and start time.
The final outcome must be `succeeded`, `refused`, `failed-before-switch` or
`failed-rolled-back`, supported by the inspection. If running identity or recovery
remains unknown, retain the unresolved outcome and handoff instead.

Prepare a private resolution file under the installation's `provenance/`
directory with exactly these fields:

```json
{
  "schema": "runtime-receipt-resolution/1.0",
  "installationId": "<same installation>",
  "operationId": "<same operation>",
  "receiptSha256": "<SHA-256 of the unresolved receipt's exact bytes>",
  "finalReceiptSha256": "<SHA-256 of the final input's exact bytes>",
  "plan": {"path": "<approved plan file>", "sha256": "<file SHA-256>"},
  "running": {"path": "<inspection evidence file>", "sha256": "<file SHA-256>"},
  "latestState": {"path": "<state evidence file>", "sha256": "<file SHA-256>"},
  "coordinator": {
    "name": "<decision owner>",
    "authority": {"path": "<retained decision file>", "sha256": "<file SHA-256>"}
  }
}
```

Each evidence file must also be private and under `provenance/`. The plan must
retain its valid canonical hash and match the original receipt's approval and
operation. Use a new diagnostic file and run this persistence-only command from
the shell holding FD9:

```bash
(
set -euo pipefail
umask 077
set -o noclobber
test ! -e "$BUNNY_RECEIPT_DIAGNOSTIC_FILE"
test ! -L "$BUNNY_RECEIPT_DIAGNOSTIC_FILE"
node apps/runtime/bin/runtime-upgrade-check.mjs resolve-receipt "$BUNNY_FINAL_RECEIPT_FILE" "$BUNNY_INSTALL_ROOT" "$BUNNY_RESOLUTION_FILE" 2> "$BUNNY_RECEIPT_DIAGNOSTIC_FILE"
)
```

Before publishing the final receipt, this command durably retains the original
bytes as `provenance/unresolved-<operationId>-<receiptSha256>.json`. It refuses
changed evidence, a conflicting retained copy, a missing lock or changes to the
original operation. It sends no service or device command. Keep the resolution,
both receipt inputs, original retained bytes, observations and decision.

If publication or synchronization fails, inspect the actual receipt before
retrying. A visible final receipt can be persisted again with the ordinary
`receipt` command using the identical final input. A still-unresolved receipt
requires another inspected resolution. Neither path authorizes replaying an
upgrade, recovery or device command.

## First adoption

Prepare the exact one-time override only after baseline provenance and recovery
are verified. It keeps the existing unit, Node executable, arguments, state,
configuration, port and hooks, but resolves the runtime entry and working
directory through the owned `current` anchor. Retain original unit/override bytes
and the exact restoration sequence. Obtain the owner's approval for those named
adoption and startup effects before installed execution.

Prepare the exact draft from the private adoption plan without touching systemd.
`BUNNY_PLAN_FILE` names that reviewed plan; `BUNNY_DRAFT_OVERRIDE` is a new private
file in its provenance directory. This fixed-host command preserves the observed
Node executable and every runtime argument, replacing only the entry path and
working directory with the anchor. It refuses arguments needing systemd quoting
or substitution rules; qualify such a layout separately rather than guessing.

<!-- qualification: draft-adoption -->
```bash
node --input-type=module - "$BUNNY_PLAN_FILE" "$BUNNY_INSTALL_ROOT" "$BUNNY_DRAFT_OVERRIDE" <<'JS'
import {open} from 'node:fs/promises';
import {dirname, join} from 'node:path';
import {canonical, sha256} from './apps/hub/dist/install/files.js';
import {syncDirectory} from './apps/hub/dist/install/stage.js';
import {readPrivateFile} from './apps/runtime/dist/src/state.js';
import {renderUpgradeAdoptionDraft} from './apps/runtime/dist/src/upgrade-paths.js';
const [planFile, root, destination] = process.argv.slice(2);
const {planSha256, ...plan} = JSON.parse((await readPrivateFile(planFile, 256 * 1024)).toString('utf8'));
if (sha256(canonical(plan)) !== planSha256 || plan.schema !== 'runtime-upgrade-plan/2.0' || plan.operation !== 'adoption'
  || plan.eligibility !== 'forward-eligible' || plan.paths.directories[0].path !== root
  || dirname(destination) !== join(root, 'provenance') || destination !== plan.execution.adoption.draftFile
  || plan.owner.argv[0] !== plan.owner.executable
  || plan.owner.argv[1] !== plan.owner.entry) throw new Error('adoption-draft-refused');
const bytes = renderUpgradeAdoptionDraft(root, plan.owner);
if (sha256(bytes) !== plan.paths.adoptionDraftSha256) throw new Error('adoption-draft-refused');
const file = await open(destination, 'wx', 0o600);
try { await file.writeFile(bytes); await file.sync(); }
finally { await file.close(); }
await syncDirectory(dirname(destination));
JS
```

Retain the draft's exact bytes/hash and the original unit fragments in the
owner-approved adoption record. The draft authorizes no service change. In the
approved window, after durable intent, stop, exit checks and backup, select the
verified baseline through `current` using the selection command above. The
selected installed layout has no existing anchor override: require the exact
new override filename and its directory to remain absent as approved. If either
has appeared, inspect and replan instead of overwriting it.

Create only the approved override directory and file:

<!-- qualification: adoption-install -->
```bash
(
set -euo pipefail
mkdir -m 700 -- "$BUNNY_UNIT_OVERRIDE_DIRECTORY"
(umask 077; set -C; cat -- "$BUNNY_DRAFT_OVERRIDE" > "$BUNNY_UNIT_OVERRIDE_FILE")
cmp -- "$BUNNY_DRAFT_OVERRIDE" "$BUNNY_UNIT_OVERRIDE_FILE"
sync -- "$BUNNY_UNIT_OVERRIDE_FILE" "$BUNNY_UNIT_OVERRIDE_DIRECTORY" "$(dirname -- "$BUNNY_UNIT_OVERRIDE_DIRECTORY")"
systemctl --user daemon-reload
systemctl --user start bunny-runtime.service
)
```

Both override variables are exact paths from the approved adoption record,
under the existing user unit directory for `bunny-runtime.service`. Recheck the
approved draft hash before copying. Compare the effective unit, unchanged
arguments, Node bytes and preserved original fragments, then verify the new
process and authenticated baseline build/health as above. For routine upgrades,
the accepted closure pins this new override too; create no further override.

If the baseline cannot be verified through the anchor, stop and verify exit.
Compare the created override with its approved bytes before removing that exact
file. Keep its copied evidence, the empty directory and retained anchor/releases;
do not recursively remove a unit directory or alter other fragments. Reload
systemd, start the preserved direct baseline unit and verify identity/health on
latest state. A mismatched override or failed recovery needs inspection and a
truthful failed/interrupted receipt, not an automatic retry or backup restore.

Verify the baseline through the anchor before the candidate upgrade. Use the
[routine operation checklist](#routine-operation-checklist) for one
forward upgrade in the coordinated runtime window. Recovery occurs only after
an actual failure under the exact approved plan; end that window without
re-upgrade. Record source qualification, first adoption, installed running/health
verification and dependent ONN physical acceptance separately, with deliberate
live recovery and re-upgrade untested unless separately exercised.

## Lighting composition state

`lighting_layout` adds one private core row containing bounded room names,
assignments, scoped groups and Home selections. The core initializes an absent
row to automatic discovery, then replaces it only with an exact-revision
operator save in the same transaction as its state and tracked outcome. Normal
core backup preserves it; no device configuration or room assignment is inferred.
The focused lighting-layout tests verify rollback on a failed transaction,
conflicting saves and reopening the production store on restart. This is forward
persistence evidence, not qualification of an older reader on latest state;
recovery eligibility remains separately stated by the upgrade plan.

Since #1933 a Home group may hold Wemo plugs. The core publishes
`lighting-layout/2.1`, whose groups carry an optional `plugs` list; the stored
row keeps its shape and needs no migration. An older release serves such a row
unchanged and shows a group that holds a plug with its controls blocked; it sends
no command to that group. It refuses, changing nothing, every lighting save that
still carries `plugs`, but accepts one that removes the last group holding a
plug. Its Ungroup of that group returns the plug to the lighting Home selection
as if it were a light: its core places a `light:device:<plug>` card in the
group's Wide shape and drops the plug's own `device:bunny/modules/wemo:<plug>`
card. No command is sent and no data is lost. Recovery is forward: reinstall the
release that knows plug groups; Home then shows that card as unavailable, so
remove it and add the plug again in Edit Home. Before a planned downgrade,
ungroup the groups that hold plugs in the current release.

## Music card placement state

`playback_layout` adds one private core row of bounded logical playback/room IDs.
It starts empty and changes only through an operator's exact-revision save.
Production-store tests cover atomic rollback, conflicting saves and reopening
latest state after restart. Preserve the table with the ordinary consistent core
backup. This is additive forward persistence evidence; it does not qualify an
older release as a recovery reader or change playback settings or AirPlay output.

## Home arrangement state

`home_layout` adds one versioned core row containing desktop and phone widget
identities, supported sizes and hidden flags. A null arrangement preserves the
built-in defaults until the first explicit save. Production-store tests cover
exact-revision admission, expiry, rollback, repeat request identity and reopening
latest state. Existing lighting group and room actions reconcile saved Home
placements within their own metadata transaction; combined-family subscribers
receive those changes in revision order. The consistent core backup preserves
this table. No device settings, media or private source contents are added to
it. Forward persistence evidence does not qualify older-reader recovery.

Since #1672 a placement may also carry an optional card `shape` beside its
`size`, published as `home-layout/2.2`; the row stays `version: 1` and no store
migration runs. A release from before #1672 reads and syncs a stored row that
carries shapes, but its `home-layout-set` schema has no `shape`, and its
dashboard copies the saved placements into every save, so every Home save from
it is refused `invalid-request` and changes nothing; no device command is
involved. A width-only save is accepted and removes the shapes. To edit Home
again after returning to such a release, in its dashboard choose Edit Home,
Reset with Desktop selected, Reset with Phone selected, then Done.
