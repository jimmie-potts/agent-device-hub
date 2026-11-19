## MODIFIED Requirements

### Requirement: Agent-session core

The runtime SHALL host the agent-session core, the module named `core`, as the one owner of agent sessions, with the source `bunny/core`. It SHALL be first in the shipped module list, as a factory whose real and simulated builds are the same, and SHALL register its sync owner, its subscription to `bunny.event.lifecycle.*` and its `notice-acknowledge` responder before its start first awaits, so that a module that syncs from it or republishes to it in its own start finds it listening. It SHALL reduce each `lifecycle` observation with its own session logic in `apps/runtime/src/core/session/`, without a lifecycle 1.x envelope and without `@jimmie-potts/agent-state`'s owner, and SHALL keep each session in its own tables in the core store. Its consumers SHALL be `dashboard`, `nanoleaf` and `pixoo` by default, with their clear-on-new-turn settings.

For each observation it SHALL check the message against profile 2.0, drop a duplicate by `(source, id)`, refuse the same `(source, id)` with other content as `duplicate-conflict`, and apply the observation through its transition, changing nothing for a refused one. Each committed change SHALL publish, as `bunny/core` and in the observation's trace, the `session/3.0` state of every record whose public content changed, a removal with reason `expired` or `retired` for every record removed, and the occurrences `attention-raised`, `attention-cleared` with its cause, `turn-ended` naming the retained notice, and `session-ended` before a runtime end's removals. A finished turn SHALL stay on its session record as a notice and SHALL NOT become an inbox item. A record's revision SHALL be the core's revision of its last published change, one counter for every family the core serves. A new session's generation SHALL be the core revision of the transaction that created it, so a generation is never after its revision and never repeats.

The core SHALL keep each root session's latest host session ID with its record, so it survives a restart, and SHALL never use it as an identity. It SHALL serve `session` through sync at its revision after committing any transition that is due, so one revision always carries one payload. The module test kit SHALL pass for it.

#### Scenario: Sessions from hook observations
- **WHEN** the core runs with no device module and a hook publishes two sessions' observations
- **THEN** health is `ok` with the core running, a synced copy holds both sessions from `bunny/core` in the hook's trace, and the core logs each observation `accepted` with its participant and message ID

#### Scenario: An approval prompt and a finished turn
- **WHEN** a hook observes a turn start, an approval prompt, its resolution and the turn's end
- **THEN** the core publishes `attention.raised`, `attention.cleared` with cause `resolved` and `turn.ended`; the record ends `finished` with no attention and one unread notice; and nothing in the inbox family is published

#### Scenario: Occurrences as MAPPING.md names them
- **WHEN** an approval without a request ID is forgotten at its turn's end, a newer turn retires one raised on an earlier turn, and a runtime end retires a session and its subagent
- **THEN** `attention.cleared` names cause `turn-ended`, then cause `turn-retired` with the observation's turn and the item's own turn, and `session.ended` precedes one `retired` removal per record at one revision, which history keeps

#### Scenario: Expiry
- **WHEN** a session has had no lifecycle evidence for 24 hours
- **THEN** the core publishes its removal with reason `expired`, and history keeps its earlier `turn.ended`

#### Scenario: Freshness at five minutes
- **WHEN** five minutes, and then an hour, pass on the runtime's clock without evidence for a working session, and for a session whose turn ended on a question
- **THEN** the core publishes neither (Hub #1947), the working session's work stays confirmed, the waiting session still needs the owner, and the core's next timer is the first session's expiry

#### Scenario: After a restart
- **WHEN** the core restarts on its store holding a working session, a session with a question and a session with an unread finished turn
- **THEN** the working session, and the session whose turn still runs under its question, are published with their running work unconfirmed for the restart, the question's session still needing the owner; the finished session keeps its status and is not republished; the host session ID is kept; and work is confirmed again only by qualifying evidence observed after the start

#### Scenario: Start order
- **WHEN** a module after the core syncs the sessions and republishes an outcome its outbox kept in its own start
- **THEN** its sync completes and the core's part takes the outcome

#### Scenario: The module test kit
- **WHEN** the module test kit runs on the core
- **THEN** every check passes: its manifest, its start and stop, its sync of `session`, and a refused acknowledgment in the shared error body

#### Scenario: A reference history
- **WHEN** every case of the shared session case set, `packages/event-contracts/fixtures/v2/session-cases.json`, runs through the core with the runtime's injected clock
- **THEN** the core publishes each case's expected records and its occurrence sequence in order, and nothing else

### Requirement: Core store transactions and failures

The core store SHALL keep each session as a row of its own tables, with its retirement guards, in the core module's database `modules/core.sqlite`. It SHALL open inside the core's start, before the core serves a sync or republishes: it SHALL borrow the runtime's ownership of the lease on `core.sqlite-owner`, or take that lease when the runtime passed none, then create every core part's tables, run the one-time session reset when it applies, and load its revision, commit count and records. A second runtime SHALL be refused at the runtime's ownership, or when it opens the core's database, which the first keeps to itself with SQLite exclusive locking; no stored owner ID SHALL be needed. Each change SHALL commit the transition's sessions and removals, the profile 2.0 messages it publishes, the published records, the history rows of everything it publishes, each state as a compact change event and every removal and occurrence whole (see "Core history"), and the `(source, id)` of the intake it took, kept for 24 hours past the later of the commit and the observation's own instant, in one SQLite transaction through the SDK's outbox, and its messages SHALL go out only after the commit, in order. Each change SHALL take that one commit, and what it published one more after the sends, both at the connection's level; after a crash between the sends and that commit, the next start SHALL send the change's messages again with their stored `id`s. A change that does not commit, a failed rollback included, SHALL change nothing, publish nothing and never be reported committed. On a full disk the core SHALL refuse the change before anything reports it accepted and log the intake `rejected` with `capacity`, so the next observation is taken once there is room. A full disk SHALL never fail the core: a store that cannot open, a full disk at the start, whether a first start, where the store cannot create its tables, or a start after a clean stop, and a due transition the store refuses SHALL leave it running, refusing durable work with `capacity` or `unavailable` and syncs with `unavailable`, and trying again after a backoff that doubles from 1 s to 60 s. While the store refuses durable work, the core SHALL record the transition once, then a summary at most once a minute, then the recovery, with each attempt at DEBUG. A publication refused after a commit SHALL leave the change standing, be recorded once per run of refusals as `outbox.deferred`, and go out at the next commit or start with the message's stored `id`, `time` and trace context. After a crash between a commit and its publication, the next start SHALL send each stored message once.

#### Scenario: One transaction
- **WHEN** an observation commits a session and an attention item
- **THEN** the session row, the records, the core's revision, the history rows of the session's changes and of the occurrence, and the intake's `(source, id)` are stored, and the outbox lets the messages go once they are published

#### Scenario: The old Hub's format
- **WHEN** a store is written and the core starts again on it
- **THEN** no `state` table in the old Hub adapter's format exists, and the core holds every committed session with its generation, notices, acknowledgments and retirement guards

#### Scenario: A full disk
- **WHEN** the store's file can grow no further and an observation would create a session
- **THEN** the commit fails, the store names the failure `full`, every row is unchanged, nothing is published, the runtime logs the intake `rejected` with `capacity` at WARN and no second `accepted`, and once there is room the same message is taken

#### Scenario: A publication refused after the commit
- **WHEN** the core's participant refuses every publish while two observations commit
- **THEN** both are reported taken, the refusal is reported once as `committed, awaiting publication`, the records hold the change, and once publishing is allowed the stored messages go out unchanged

#### Scenario: A crash between commit and publish
- **WHEN** the runtime process is killed after the core commits an observation and before it publishes anything, and the runtime starts again twice on the same state directory
- **THEN** the state and occurrence were stored unpublished; at the first restart each goes out once, with its stored `id`; and the second restart sends neither again

#### Scenario: A duplicate after a restart
- **WHEN** a hook's observation is sent again with the same `(source, id)` after the core restarted, or with other content
- **THEN** the first is a duplicate and the second a conflict

#### Scenario: The lease
- **WHEN** a second runtime starts on the state directory of a running one, and an offline tool holds the lease when a runtime starts
- **THEN** the second runtime is refused before its core opens the store and the first keeps running, and the runtime that finds the tool's lease exits with `core-failed`

#### Scenario: The lease through a failed commit
- **WHEN** a commit is refused on a full disk and the core takes the next observation once there is room
- **THEN** the refused change leaves the revision as it was and takes nothing, the store stays open with its lease held throughout, and the next change commits at a higher revision

#### Scenario: A lock that cannot keep a journal
- **WHEN** the lock database's rollback journal cannot be written
- **THEN** the lease is still taken

#### Scenario: A full disk that persists
- **WHEN** a due transition falls on a full disk, the core restarts with stored sessions on a full disk, or the reset at its first start falls on one
- **THEN** the core keeps running and health shows it running; intake is refused with `capacity` and syncs with `unavailable`; within the backoff the core does not try again; and once there is room the next attempt succeeds and the condition ends with one record

#### Scenario: A real full disk at the start
- **WHEN** the runtime's state directory is on a full disk that refuses every write with ENOSPC, and the core starts on it for the first time, or again after a clean stop
- **THEN** the core opens its database and runs, health shows it running, an observation is refused with `capacity` and a sync with `unavailable`, and once there is room the next observation is taken and syncs are served

#### Scenario: Retries back off
- **WHEN** the store refuses a due expiry for two minutes
- **THEN** the core tries at 0, 1, 3, 7, 15, 31, 63 and 123 s, logs the transition and two summaries with the refusals since, and publishes the removal at the next attempt once there is room

#### Scenario: The (source, id) window
- **WHEN** a hook whose clock runs two hours ahead sends an observation, and a day and an hour later another intake prunes what is due
- **THEN** the observation's `(source, id)` is still a duplicate, and one from the commit's own instant is pruned exactly 24 hours on

#### Scenario: Commits per observation
- **WHEN** an observation raises an approval on a session the core already holds, on a store opened as the runtime opens it
- **THEN** the change commits once with its records, history and intake, its state and occurrence go out, and one more commit forgets them, both at FULL

#### Scenario: A crash after the sends
- **WHEN** the core's process dies after an observation's state and occurrence went out and before their bookkeeping committed, and the store starts again twice on its file
- **THEN** the first start sends both again exactly as first sent, so a consumer that drops duplicates takes each once, and the second sends neither

### Requirement: Operator approval recovery

The core SHALL answer the `approval-recover` command on `bunny.cmd.approval-recover.<session>` through its session logic, carrying the old Hub's `recover-approval`. It SHALL retire the one approval marker without an attention ID that the session holds on `turnId`, only while a core restart left the session's running work unconfirmed, the only marking the core keeps (Hub #1947), so silence alone SHALL never allow it; commit before it replies `accepted`; and publish `attention-cleared` with cause `recovered` and the session at its new revision in the command's trace, with no outcome. It SHALL refuse an unknown session with `not-found`, an `expectedRevision` other than the session record's revision with `revision-conflict`, and a session with no such marker or confirmed work with `invalid-state`, changing nothing. The gateway SHALL send it as the caller's source from `POST /api/v2/commands/approval-recover` to a caller with `control`, and from the MCP tool `core_recover_approval`; a remote part with `control` MAY request it through the SDK edge. The core's manifest SHALL contribute the MCP read tool `core_sessions`.

#### Scenario: Recovery only while evidence is uncertain
- **WHEN** an approval without an ID is raised on a turn, an operator recovers it while work is confirmed, for an unknown session, after five minutes of silence, then after a core restart with a stale revision, for another turn, with the current revision, and again
- **THEN** the answers are `invalid-state`, `not-found`, `invalid-state`, `revision-conflict`, `invalid-state`, `accepted` and `invalid-state`; the accepted recovery clears the marker with an `attention-cleared` occurrence of cause `recovered` in the command's trace, and the core publishes no outcome

#### Scenario: The sessions tool
- **WHEN** `core_sessions` is read before the core starts, and then with no filter, `q`, `provider` and a session ID
- **THEN** it answers `unavailable` first, then the `session/3.0` records at the core's revision, filtered by label, title, project or session ID ignoring case, and by provider

### Requirement: Session claims, status and aging

Each stored session SHALL hold separately evidenced claims: work (`active`, `idle`, `interrupted` or `unknown`), attention, outcome (notices, per-consumer acknowledgments and read evidence) and relationships (working and unconfirmed children), each with its evidence time and confidence. The core SHALL compute the session's status from its claims with the contracts package's status function. The core SHALL own every time-driven change of meaning. Silence SHALL NOT change any claim (Hub #1947): a session SHALL keep the work state its evidence gave it until new evidence, a core restart, its end or its expiry after 24 hours without lifecycle evidence. Only a core restart SHALL make running work unconfirmed without explicit evidence saying so, with reason `restart`. Explicit lost or conflicting evidence SHALL change the affected claim and publish at once. Only qualifying evidence for the current turn, `turn-started`, `activity-observed` or `attention-resolved` on that turn, SHALL confirm work. A child SHALL count as working on its parent only while its own work claim is active and confirmed.

#### Scenario: A quiet question
- **WHEN** a session whose turn ended on a question is silent for ten minutes, and a session whose turn still runs under its question is too
- **THEN** both still need the owner, the core publishes neither, and the second's running work and attention stay confirmed

#### Scenario: Late evidence for another turn
- **WHEN** a restart left a session's work unconfirmed and a tool result arrives for an ended turn
- **THEN** work stays unconfirmed and nothing is published for it

#### Scenario: A working child
- **WHEN** a root is idle, one child's work is confirmed and a restart left another child's work unconfirmed
- **THEN** the root's status is `working` with detail `subagent`, and its children count one working and one unconfirmed

#### Scenario: Silent work
- **WHEN** a working session sends no evidence for an hour
- **THEN** its work stays active and confirmed, the core publishes nothing for it, and its record's evidence time shows when the hub last heard from it

### Requirement: Session transitions commit as one result

The core's session logic SHALL be one pure transition from the stored sessions, one input and the core's instant to a result: every changed session, including affected parents and descendants; every removal with its reason and retirement guards; the occurrences in order; and the next instant a session expires or a guard lapses. The store SHALL commit the whole result in one transaction or nothing, and SHALL NOT reconstruct a change's cause or derive occurrences by comparing states. A record's evidence time SHALL be part of its public meaning at a coarse resolution, one named constant of one minute (`SESSION_LIMITS.evidenceResolutionMs`, Hub #1947): a work observation that changes no other public member SHALL write the session row and publish nothing until its `lastEvidenceAtMs` is at least that resolution past the published record's, and SHALL then publish at a new revision. A busy session SHALL therefore publish for its evidence alone at most once per resolution, its published evidence time SHALL lag the hub's last evidence by less than the resolution, and a silent session SHALL publish nothing. Every change of public meaning, confirmation changes included, SHALL publish at a new revision that history keeps. Transport duplicates by `(source, id)`, semantic duplicates and collisions, ordering watermarks and retired-turn guards SHALL remain four distinct protections.

#### Scenario: Progress without a revision
- **WHEN** a working session receives eleven qualifying work observations for its current turn within a minute of its published evidence time, and one more a minute after it
- **THEN** the first confirmed change publishes once, the eleven publish nothing and add no history row, and the last publishes the new evidence time at a new revision with one history row

#### Scenario: A runtime end with a subagent
- **WHEN** a runtime end arrives for a root with one child
- **THEN** one transaction removes both with reason `retired`, keeps their guards, and publishes `session.ended` before both removals

#### Scenario: A result that cannot commit
- **WHEN** a part's deriver throws while a transition's result commits
- **THEN** no session, removal, occurrence, history row or intake record changes

#### Scenario: A busy session's hour
- **WHEN** a working session sends qualifying work evidence every 1 s, 5 s, 30 s, 59 s, 61 s, 90 s or 5 minutes for an hour, and another is silent for an hour
- **THEN** the first publishes 60, 60, 60, 30, 59, 40 and 12 revisions with as many history rows, its published evidence time lags its last evidence by less than a minute, and the silent session publishes none
