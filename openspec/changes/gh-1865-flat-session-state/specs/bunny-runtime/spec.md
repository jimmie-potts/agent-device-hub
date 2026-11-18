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
- **WHEN** five minutes pass on the runtime's clock without qualifying work evidence for a working session, and for a session waiting on a question
- **THEN** the core's timer publishes the working session with unconfirmed work at a higher revision, a millisecond earlier nothing was published, and the waiting session is not republished and still needs the owner

#### Scenario: After a restart
- **WHEN** the core restarts on its store holding a working session, a session with a question and a session with an unread finished turn
- **THEN** the working session is published with work unconfirmed for the restart, the other two keep their status and are not republished, the host session ID is kept, and work is confirmed again only by qualifying evidence observed after the start

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
- **WHEN** the store refuses a due work deadline for two minutes
- **THEN** the core tries at 0, 1, 3, 7, 15, 31, 63 and 123 s, logs the transition and two summaries with the refusals since, and publishes the record at the next attempt once there is room

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

The core SHALL answer the `approval-recover` command on `bunny.cmd.approval-recover.<session>` through its session logic, carrying the old Hub's `recover-approval`. It SHALL retire the one approval marker without an attention ID that the session holds on `turnId`, only while the session's work claim is unconfirmed for its deadline or a restart; commit before it replies `accepted`; and publish `attention-cleared` with cause `recovered` and the session at its new revision in the command's trace, with no outcome. It SHALL refuse an unknown session with `not-found`, an `expectedRevision` other than the session record's revision with `revision-conflict`, and a session with no such marker or confirmed work with `invalid-state`, changing nothing. The gateway SHALL send it as the caller's source from `POST /api/v2/commands/approval-recover` to a caller with `control`, and from the MCP tool `core_recover_approval`; a remote part with `control` MAY request it through the SDK edge. The core's manifest SHALL contribute the MCP read tool `core_sessions`.

#### Scenario: Recovery only while evidence is uncertain
- **WHEN** an approval without an ID is raised on a turn, an operator recovers it while work is confirmed, for an unknown session, then after five minutes with a stale revision, for another turn, with the current revision, and again
- **THEN** the answers are `invalid-state`, `not-found`, `revision-conflict`, `invalid-state`, `accepted` and `invalid-state`; the accepted recovery clears the marker with an `attention-cleared` occurrence of cause `recovered` in the command's trace, and the core publishes no outcome

#### Scenario: The sessions tool
- **WHEN** `core_sessions` is read before the core starts, and then with no filter, `q`, `provider` and a session ID
- **THEN** it answers `unavailable` first, then the `session/3.0` records at the core's revision, filtered by label, title, project or session ID ignoring case, and by provider

### Requirement: Core save cost

The core store SHALL measure each save that commits: one transition's commit, from before it serializes the changed session rows until the outbox's transaction has committed, before any of its messages is published. A save's time SHALL be read from a monotonic clock. The store SHALL log `storage.cost.high` at WARN as one save takes longer than 100 ms, carrying its time in whole milliseconds rounded up in `bunny.save.duration_ms`; the condition SHALL be recorded once per run, and the first save back within its limit SHALL log `storage.cost.normal` at INFO with that save's time. The size condition and its `bunny.state.bytes` record SHALL be retired with the state block, since one row per session and at most 128 sessions keep every save far below the old limit. Both records SHALL carry `bunny.operation` `storage` and no other field, never a session's content. A save that does not commit SHALL change neither condition, the runs SHALL be kept in memory only, and a logger that throws SHALL lose only its record: the save SHALL stand. Part transactions that write no session row SHALL NOT be measured.

#### Scenario: A state block past its limit
- **WHEN** the core holds 128 sessions with the largest notices and attention its limits allow, and saves change each of them
- **THEN** no save logs a size record, because no state block exists, and only the time condition can record a costly save

#### Scenario: A slow save
- **WHEN** saves take 5 ms, exactly 100 ms, 100.25 ms, 250 ms, 5 ms and 5 ms of work in their transactions, and each message's publication after its commit takes a second
- **THEN** the store logs one `storage.cost.high` WARN with 101 ms and one `storage.cost.normal` INFO with 5 ms, publication counts toward no save, and every save commits

#### Scenario: A save that does not commit
- **WHEN** a slow save commits, a quick one is rolled back by a part that throws, and then a quick save commits
- **THEN** the store logs the WARN, nothing for the refused save, and the INFO only for the save that committed

#### Scenario: A logger that throws
- **WHEN** a slow save and then a quick one commit while the logger throws on every record
- **THEN** both observations are accepted at two consecutive revisions, and the session rows hold the second

### Requirement: Guarded durable label completion

The core SHALL set a label with user provenance or clear it through its session logic, retaining explicit-user precedence and title/native neutral fallback. It SHALL refuse an unknown session with `not-found` and an unequal session-record revision with `revision-conflict`, including an intervening due transition. The session save, tracker completion, history, outcome and participating tracked projections SHALL commit atomically before a successful reply. A same-user-label or already-clear request SHALL complete without inventing a session revision. Metadata completion SHALL NOT claim physical-device evidence.

#### Scenario: Set, clear and restart
- **WHEN** a control caller sets and then clears a session label using its current revision and the core restarts
- **THEN** each completed change is reflected in the session record and retained history, user precedence holds when set, and the fallback is restored when cleared

#### Scenario: Revision and existence refusals
- **WHEN** the session is unknown or its revision changes before the label mutation, including a due transition queued ahead of it
- **THEN** the core returns `not-found` or `revision-conflict` respectively and leaves the current session unchanged

#### Scenario: No-op
- **WHEN** the current user label already equals the request or the session already has no label and clearing is requested
- **THEN** the tracked action completes durably and the session record retains its revision

#### Scenario: Live operation projection
- **WHEN** a label action completes, including a no-op or a result arriving after transport uncertainty
- **THEN** the real operation projection is published in the outcome's transaction and its live copy agrees with a fresh snapshot of the completed operation

#### Scenario: Transaction failure
- **WHEN** state saving, outcome validation, a tracked projection or storage capacity prevents the transaction from committing
- **THEN** the session, completion, history and outcome roll back together, no success is reported, and the core preserves its existing recovery behavior

### Requirement: Qualified explicit read receipts commit against the displayed target

The runtime SHALL explicitly adopt lifecycle/2.1 for a qualified authenticated producer. It SHALL require full identity, generation, known lifecycle turn, exact finished notice and eligible root activity to match inside its serialized owner operation. An owned-UI view revision SHALL match the exact session record used to bind the displayed target. Qualified producers SHALL include the observed Claude terminal implementation and the protocol-qualified Codex Desktop observer for the unchanged `codex/local` identity. Unqualified clients SHALL produce no positive read. A provider-client receipt SHALL carry the observed native revision and the matching accepted revision, with duplicate protection for the same accepted action.

Receipt evidence SHALL commit with the session revision, history and outbox. It SHALL NOT create a session, acknowledge a consumer, clear attention or count as work evidence. Subsequent transitions SHALL retain the receipt only for its eligible generation, turn and notice. An admitted native read update SHALL replace the receipt evidence. A removed session SHALL retain no active receipt.

#### Scenario: Matching explicit action
- **WHEN** a qualified Claude receipt matches the completed target and displayed revision
- **THEN** the core publishes read state with its receipt provenance at a new revision
- **AND** the work claim, attention and consumer acknowledgments remain unchanged

#### Scenario: Matching provider-client action
- **WHEN** a qualified Codex receipt carries an accepted native action and matches its frozen owner generation, completed turn and notice
- **THEN** the core commits and publishes that target's read provenance through the existing transaction and outbox
- **AND** the session remains `codex/local` with no added title or archive evidence

#### Scenario: Late or repeated action
- **WHEN** an older pane is clicked after any intervening session revision, including a new turn or unread observation, or the same receipt arrives again
- **THEN** it makes no new read transition and cannot clear a newer notice

#### Scenario: Obsolete provider target
- **WHEN** a Codex action arrives after its generation, turn or finished notice changed, or its accepted-action message is replayed after restart
- **THEN** it makes no new read transition and cannot clear a newer notice

#### Scenario: Failed commit and restart
- **WHEN** a receipt commit fails
- **THEN** neither the active record nor its publication changes
- **WHEN** a committed receipt is followed by a runtime restart
- **THEN** its matching read evidence survives the restart and the outbox republishes without another user action

#### Scenario: Missing qualification
- **WHEN** an ordinary lifecycle credential, mismatched feed, unsupported client or invalid receipt reaches intake
- **THEN** the runtime refuses it under the existing shared error and diagnostic conventions without changing session state

#### Scenario: Existing enrollment after a compatible Codex update
- **WHEN** the enrolled Codex producer observes the same qualified native action after an application update
- **THEN** the existing credential and full feed identity still qualify the receipt without re-enrollment
- **AND** all generation, turn, notice, replay and source checks still apply

### Requirement: Core event automation

The core SHALL own fresh event rules, interrupt sets, quiet hours and budgets in its private database, retaining the legacy rule and settings shapes without transferring legacy data. Rules SHALL evaluate only new live attention-raised, attention-cleared, turn-ended and session-ended occurrences. Sync, restart, stored outbox republication, duplicate occurrences, the restart's work marking and the one-time session reset SHALL start no moment. Arbitration SHALL retain no-flourishes, quiet hours, per-agent/task and global budgets, device spacing, the Work interrupt set, mode and alert precedence; the active alert SHALL be any session whose status needs the owner. Each matching enabled rule SHALL hand at most one moment per target to the tracked dispatcher, with a shared runtime-clock start instant and no retry. Acceptance SHALL remain distinct from terminal completion, failure or uncertainty; the Automation log SHALL link to the current tracked operation and SHALL NOT infer readership or physical success.

#### Scenario: A matching live occurrence
- **WHEN** a new live occurrence matches an enabled rule and policy permits its target
- **THEN** one tracked moment is dispatched for that rule and target and its acceptance and eventual outcome are separately inspectable

#### Scenario: Restart, sync and duplicate delivery
- **WHEN** the core restarts, synchronizes or republishes an older occurrence, or receives another copy of a live occurrence
- **THEN** no second moment starts, including when a rule was created after the original occurrence

#### Scenario: A policy blocks a moment
- **WHEN** quiet hours, a budget, device spacing, Quiet mode or an active alert forbids the moment
- **THEN** the log records the policy reason and no moment command is sent

#### Scenario: The cutover reset
- **WHEN** the core first starts on a store holding old session data and pending session publications, with rules enabled for every agent occurrence
- **THEN** no occurrence is published, no rule is evaluated and no moment is dispatched

### Requirement: Agent hooks and Codex Desktop in the catalog and disposable runs

The harness contract SHALL include a `hook` call that runs the 2.0 hook script (`runtime-agent-hooks`) once, as a client's hook command does, with an unchanged lifecycle 1.x producer file naming the runtime's port and a payload on stdin, and that, asked with `runtime: 'stopped'`, runs it while the runtime is stopped and starts the runtime again on the same state directory and port afterwards. Each execution adapter SHALL grant the agent hooks' converted producer credential (`PRODUCER`, with `ingest` alone, under a run-generated token in the Hub's form with the synthetic prefix `tok_SYNTHETIC835`) beside the parts' credentials, and its `gateway` call SHALL also act as that producer. The hook's environment SHALL carry no Claude Code variable and no `CODEX_HOME` of the process that runs it. The catalog SHALL also cover the agent hooks through the 2.0 hook script and the Codex Desktop module with a simulated marker (`runtime-codex-desktop`). In a disposable run the supervisor SHALL write the producer file once it knows the runtime's port, at `<data>/config/producer/producer.json`, owner-only; its harness API SHALL drive the simulated marker, and its restart SHALL take an optional `holdMs`, a whole number of milliseconds up to 10,000, for which it keeps the runtime stopped before it starts it again; the runtime's child SHALL reach the simulated marker over its IPC channel without a path; and the served candidate SHALL include the hook script and the module's build, whose sources `build-current` watches.

#### Scenario: Agent hooks on both transports and in a run
- **WHEN** `agent-hooks` runs in process, through the edge and in a disposable run: the hook script reports a Claude Code session's start, a prompt with a private canary, a permission dialog, the tool that ends it and the turn's end; the producer's credential sends a command and reads; a hook runs while the runtime is stopped; and the next hook runs after the restart
- **THEN** each hook exits 0 within 3 s and writes nothing; the session appears quiet with its project, holds the turn, raises the approval prompt and clears it as resolved, and ends finished with its notice; the producer's command and read are `forbidden` and its authority is `ingest`; the hook while the runtime is stopped is lost, so after the restart the session keeps its turn and its finished status, with no work to mark unconfirmed, until the next hook starts a new turn and confirms work on it; and no record, message or answer holds the canary or a token

#### Scenario: Codex Desktop's marker on both transports and in a run
- **WHEN** `codex-desktop-read` runs in process, through the edge and in a disposable run
- **THEN** it passes as `runtime-codex-desktop` "Simulated marker and acceptance tiers" requires, and every message the parts see follows profile 2.0

## ADDED Requirements

### Requirement: Session claims, status and aging

Each stored session SHALL hold separately evidenced claims: work (`active`, `idle`, `interrupted` or `unknown`), attention, outcome (notices, per-consumer acknowledgments and read evidence) and relationships (working and unconfirmed children), each with its evidence time and confidence. The core SHALL compute the session's status from its claims with the contracts package's status function. The core SHALL own every time-driven change of meaning: active work SHALL become unconfirmed, with reason `deadline`, five minutes after its last qualifying work evidence on the core's clock, and the core SHALL publish that change. Attention, outcome and idle or interrupted work SHALL NOT change through silence. Explicit lost or conflicting evidence SHALL change the affected claim and publish at once. Only qualifying evidence for the current turn, `turn-started`, `activity-observed` or `attention-resolved` on that turn, SHALL confirm work. A child SHALL count as working on its parent only while its own work claim is active and confirmed.

#### Scenario: A quiet question
- **WHEN** a session raises a question and is silent for ten minutes
- **THEN** its status still needs the owner and the core publishes nothing for the silence

#### Scenario: Late evidence for another turn
- **WHEN** a session's work turned unconfirmed and a tool result arrives for an ended turn
- **THEN** work stays unconfirmed and nothing is published for it

#### Scenario: A working child
- **WHEN** a root is idle, one child's work is confirmed and another child's work turned unconfirmed
- **THEN** the root's status is `working` with detail `subagent`, and its children count one working and one unconfirmed

### Requirement: Session transitions commit as one result

The core's session logic SHALL be one pure transition from the stored sessions, one input and the core's instant to a result: every changed session, including affected parents and descendants; every removal with its reason and retirement guards; the occurrences in order; and the next deadline. The store SHALL commit the whole result in one transaction or nothing, and SHALL NOT reconstruct a change's cause or derive occurrences by comparing states. A work observation that changes no public member SHALL advance only the session's private progress time and deadline, writing no public revision and no history row. Every change of public meaning, confirmation changes included, SHALL publish at a new revision that history keeps. Transport duplicates by `(source, id)`, semantic duplicates and collisions, ordering watermarks and retired-turn guards SHALL remain four distinct protections.

#### Scenario: Progress without a revision
- **WHEN** a working session receives ten qualifying work observations for its current turn within a minute
- **THEN** the first confirmed change publishes once, the rest publish nothing and add no history row, and the work deadline moves to five minutes after the last

#### Scenario: A runtime end with a subagent
- **WHEN** a runtime end arrives for a root with one child
- **THEN** one transaction removes both with reason `retired`, keeps their guards, and publishes `session.ended` before both removals

#### Scenario: A result that cannot commit
- **WHEN** a part's deriver throws while a transition's result commits
- **THEN** no session, removal, occurrence, history row or intake record changes

### Requirement: Root starts do not claim work

A `session-started` observation for a root the core does not hold SHALL create the session with idle work and no work turn, whatever turn it carries. For a root the core holds, it SHALL keep the work state and current turn. A child start SHALL keep its meaning as evidenced child work under its known parent. `turn-started` and qualifying activity SHALL remain work evidence. The rule SHALL apply in the core to every provider's root start, including observations from older hook releases.

#### Scenario: Launch, clear and resume
- **WHEN** a Claude root starts, starts again after `/clear` under a new ID, and starts after `/resume` with the command's prompt ID, each with no prompt submitted
- **THEN** each session's status is `quiet` with detail `idle`, its turn is unknown, and nothing reads it as working

#### Scenario: Compaction in a turn
- **WHEN** a session-start observation with another prompt ID arrives while a root's turn is active
- **THEN** the root keeps its active turn and confirmed work, and no turn or ordering becomes ambiguous

#### Scenario: A prompt after the start
- **WHEN** a quiet root receives `turn-started` and then a matching `turn-ended`
- **THEN** it is working and then finished with a notice for that turn

### Requirement: Session capacity

The core SHALL hold at most 128 sessions, roots and children from any source together. At the limit it SHALL refuse a new child. A new root SHALL displace one child subtree whose every member is finished and holds no attention, the subtree whose newest evidence is oldest first, ties to the lower identity key, through the ordinary retirement path; without one, the new root SHALL be refused. Roots SHALL never be displaced. A refusal SHALL change nothing, SHALL be recorded as `message.received` refused with `capacity`, and SHALL be silent to the reporting producer.

#### Scenario: Roots from two sources at the limit
- **WHEN** the core holds 128 sessions from two sources, among them one finished child subtree, and two new roots and a new child arrive
- **THEN** the first root displaces the finished subtree, the second root and the child are refused with `capacity`, and no root is removed

### Requirement: One-time session reset at the first start after the cutover

When the core store opens and finds the old agent-state `state` table, it SHALL, in one transaction before the core serves a sync or republishes, drop that table, empty the core's own session and retirement-guard tables, and delete the session family's published records, the session family's latest-history and span rows, and pending outbox messages of session states, session removals and agent occurrences. The reset SHALL raise the core's revision by one, SHALL publish nothing and SHALL write no history row, so the next sync serves the empty session family at a revision no earlier payload carried. It SHALL keep every other part's tables and rows, history fact rows and the taken `(source, id)` records. A start that finds no `state` table SHALL change nothing. The reset SHALL record one existing `operation.completed` storage record and no session content.

#### Scenario: A store shaped like an installed one
- **WHEN** the core first starts on a synthetic store holding an old `state` row, session records, rows in the core's session and guard tables, session latest-history and span rows, pending session and occurrence outbox rows, and another part's records and outbox rows
- **THEN** the core serves an empty session family at the stored revision plus one, the other part's rows and messages are intact, no session message goes out, and a second start changes nothing

#### Scenario: A release before the reset in between
- **WHEN** a release that predates the reset runs on a reset store and writes a `state` row, and the core then starts again
- **THEN** the reset runs again and empties the core's session and guard tables too, so no session from before it returns

#### Scenario: A crash during the reset
- **WHEN** the process dies while the reset's transaction is open
- **THEN** the next start finds the store unchanged and runs the reset again
