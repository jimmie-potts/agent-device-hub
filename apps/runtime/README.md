# B.U.N.N.Y. runtime

Private workspace package `@jimmie-potts/runtime`. It is the one runtime process
that [ADR 0012](../../docs/decisions/0012-bunny-event-platform.md) describes. It
hosts a fixed list of modules on the SDK's in-process bus and serves health,
and with `--edge` its [gateway](#gateway) for remote parts, browsers and MCP
clients, on a loopback port. The
shipped list in `src/modules.ts` holds the [agent-session core](#agent-session-core)
and, after it, every device module that [registers itself](#adding-a-module)
from its folder under `modules/` (#999): the
[playback module](../../modules/playback/README.md) (#929), the
[LIFX module](../../modules/lifx/README.md) (#928), the
[Tidbyt module](../../modules/tidbyt/README.md) (#930), the
[Pixoo module](../../modules/pixoo/README.md) (#843), the
[Nanoleaf module](../../modules/nanoleaf/README.md) (#844) and the
[Codex Desktop module](../../modules/codex-desktop/README.md) (#926) so far.
A module story adds its module in its own folder, and the runtime also runs with
no module at all. The [agent hooks](#agent-hooks) reach the core through the
gateway, with `bin/monitor-hook.mjs`.
Without a [configuration file](#configuration), the runtime refuses each module
that takes one, with `not-found`, shows it in health and runs on, so the shipped
runtime then runs the core alone, with the device modules `refused`. Installation and representative acceptance are recorded in the
[accepted fresh cutover](https://github.com/jimmie-potts/agent-device-hub/issues/840#issuecomment-6086298585),
with its scoped Wispr/CHOMPI deferrals. Source tests alone do not establish that evidence.

Modules are written against the [module API](../../packages/sdk/README.md#modules)
in `@jimmie-potts/sdk`. There is no dynamic loading, middleware or durable
subscription: adding or removing a module is a code change in its own folder,
which the build collects (see [Adding a module](#adding-a-module)). Each entry in
the shipped list is the module's factory, which creates it with its real device
transport, or with its simulated one under `--simulate`. Each module's settings
and secrets come from one private [configuration file](#configuration).

A factory whose module takes a configuration also gives a `simulatedSection`:
`{config, secrets?}`, the module's section for simulated runs without its
`secrets` member, and the names of the secrets that section needs. A module that
reads no secret, such as the playback, LIFX, Pixoo and Codex Desktop modules, omits `secrets`; the Tidbyt module
names `token`, its API key's file, and the Nanoleaf module names `token`. One helper,
`tests/fixtures/simulated.ts`, builds each section as `{...config, secrets: {<name>:
<file>}}`, with one private file holding the synthetic token for each declared
name, and writes the configuration file. The `shipped` disposable run, the
runtime's process tests, the maintenance journal test and the memory script's
`simulated` variant configure the shipped modules with it.

Wispr is the read-only file-handoff module. Its selected aggregate and diagnostics
files are entered manually in the private configuration; no collector or database
is moved. The module starts lazily and owns no analytics store or broadcast family.
Its [guide](../../modules/wispr/README.md) documents the separate browser exposure
and text-sharing choices. All authenticated read-scoped clients may read its
analytics routes; browser exposure remains off until explicitly enabled.

## Adding a module

A module registers itself from its own folder (#999), so adding runtime and
harness registration needs no shared module list:

1. Put the module in `modules/<name>/`, a workspace package that imports only
   the SDK and the contracts packages, with the module's name as its manifest
   name.
2. Export `registration`, a `ModuleRegistration` from `@jimmie-potts/sdk`, from
   the package's entry. It holds the module's factory (`name`, `create`,
   `simulate`, `schemas` and `simulatedSection`), `shipped`, and where the
   module starts: `order`, a number, lower first, and `after`, the modules that
   must start before it, such as one whose records it follows from its start.
   `registerFamilies` registers its families on a validator when they need
   checks beyond their schemas. `simulation` says how the scenario harnesses
   simulate its devices: the `actions` a scenario may ask for, which other
   fields each takes (`admits`), the in-memory harness's half (`memory`) and a
   disposable run's (`run`), whose module in the runtime's process reaches the
   supervisor's simulated device over a link.
3. Put its scenarios in `apps/runtime/tests/scenarios/modules/<name>.ts`,
   exporting `scenarios` and, for a disposable run of its own, `runs`.
4. Add its workspace and build, typecheck and test commands to the existing
   root scripts and CI. Registration collection does not yet collect those
   commands; follow [development checks](../../docs/development.md).

The build writes `dist/src/registry.js`, one static import of each folder's
`registration`, after it compiles the runtime; `src/registry.d.ts` types it.
Nothing loads at run time: the shipped set is fixed when the runtime is built.
The shipped list holds the core first, by construction, then each shipped
registration, after the modules its `after` names, and otherwise by `order`,
then by name. The list does not assemble when a registration is named `core`,
two share a name, an `after` names a module that does not ship, or modules wait
on each other. The current modules use the orders 100 to 700 in steps of 100;
a new module takes a free number.

The in-memory harness, the disposable run's supervisor and child, and the run's
seeds and plug-in collect the registrations and the scenario files, so they name
only the core and the fixture modules. `npm run test:workflow` fails when one of
those shared files names a device module (`scripts/check-module-names.cjs`).

## Agent-session core

`src/core` is the one owner of agent sessions
([Hub #831](https://github.com/jimmie-potts/agent-device-hub/issues/831)). It is
the module named `core`, and the runtime hosts it with the source `bunny/core`;
every other module is `bunny/modules/<name>`. It comes first in the shipped list.
It reaches no device, so its real and simulated builds are the same.

Its start registers its sync owner, its lifecycle subscription and its
responder before its first await. A device module that syncs from it or
republishes to it in its own start therefore finds it listening. If the core
fails, the runtime ends: the process writes `runtime.failed` with `core-failed`
and exits 1, and the service manager restarts it whole.

- **Owner and store.** It runs `@jimmie-potts/agent-state`'s owner on the core
  store in its own SQLite file, `modules/core.sqlite`. The store adapter
  (`src/core/store.ts`) is copied from the old Hub's `apps/hub/src/storage.ts`
  and keeps its format: the durable 2.1 state as one JSON row in `state`. Its
  lease is an exclusive transaction on the lock database `core.sqlite-owner`
  beside it, which has no rollback journal, so taking it writes nothing. The
  core holds it from its start until it stops, including while it opens
  agent-state's owner again after a failed commit. A second runtime on the same
  state directory cannot open the core's database, which the first keeps to
  itself (see [State](#state)), so its core fails at once; an owner that
  reaches a held lease waits for it until agent-state's three-second deadline.
  A file that holds another owner's state is refused before anything is written
  to it.
- **Intake.** It subscribes to `bunny.event.lifecycle.*`, checks each message
  against profile 2.0, drops a duplicate by `(source, id)` and refuses the same
  `(source, id)` with other content as `duplicate-conflict`, then reduces the
  observation as the lifecycle 1.2 envelope that
  [MAPPING.md](../../packages/event-contracts/MAPPING.md) describes. It keeps
  each observation's `(source, id)` in the same store for 24 hours past the
  later of the commit and the observation's own `observedAtMs`, as long as
  agent-state still admits it, so a duplicate after a restart, or from a hook
  whose clock runs ahead, is still dropped. A duplicate is logged at DEBUG.
- **Publication.** Each change derives its `session` state, removal and
  occurrence messages. One SQLite transaction commits the change with those
  messages (through the SDK's outbox), the published records, a history row for
  each occurrence and removal, and the intake's `(source, id)`. The messages go
  out after the commit, in order: a session's end, then its removals, then
  states, then the other occurrences. Once they have gone out, the outbox
  forgets them in one more commit, also synced (Hub #972). A crash between the
  sends and that commit sends them again at the next start, with the same
  `id`s. A record carries the core's revision of its last change; the core
  keeps one revision counter for every family it serves.
- **Failures.** A full disk refuses the change before anything reports it
  accepted: nothing commits, nothing is published, and the intake is logged
  `rejected` with `capacity` (an acknowledgment is refused with `capacity`).
  The store uses the SDK's `fullDisk(error)` classifier, which also recognizes
  a filesystem `ENOSPC` wrapped as a cause.
  The core then opens agent-state's faulted owner again on what committed,
  keeping its lease. The core never fails on a full disk:
  - if opening the owner fails, as when maintenance falls due, the core refuses
    durable work with `capacity` or `unavailable` and tries again on demand
    after a backoff that doubles from 1 s to 60 s;
  - at the start, a full disk leaves the core running in that state, and a
    failed refresh of the restart's uncertainty makes syncs answer `unavailable`
    until a later attempt, on the same backoff, succeeds. This holds on a real
    full disk at a first start, where the store cannot create its tables, and
    at a restart after a clean stop, since opening a module's database needs no
    new space (see [State](#state)).

  While the store refuses durable work, the core logs one `operation.failed`
  record (`bunny.operation` `storage`, WARN, or ERROR for `internal`), then a
  summary at most once a minute with the refusals since (`bunny.attempt_count`),
  and one `operation.completed` once a change commits again; each attempt is
  DEBUG. A publication refused after a commit is recorded as `outbox.deferred`:
  the change stands, and its messages go out at the next commit or start, with
  their stored `id`, `time` and trace context. A crash between a commit and its
  publication sends them at the next start, once.
- **Save cost.** Each save rewrites agent-state's whole state block, so the
  store measures every save that commits (Hub #976). A save is agent-state's
  commit through the store's lease: applying the change to the last committed
  state, which clones, validates and serializes all of it, then the one
  transaction with its records, history, intake and outbox rows, up to its
  `COMMIT`. Publication comes after and is not counted. The intake's grouped
  transactions for other participants' messages (Hub #782) and freshness
  refreshes do not write the state block and are not timed. The store logs
  `storage.cost.high` at WARN once the block passes half of the 16 MiB limit
  (`bunny.state.bytes`) or once a save takes longer than 100 ms
  (`bunny.save.duration_ms`, whole milliseconds rounded up), and
  `storage.cost.normal` at INFO with the size or time of the first save back
  within the limit. Each condition is recorded once per run, and a restart
  starts a new run. Both records carry `bunny.operation` `storage` and never
  the state's content, and a logger that throws never changes a save. The
  16 MiB limit still refuses a larger block with `state-capacity`.
- **Freshness.** Each record's `freshness` holds at the `time` of the message
  that carries it. A timer publishes a record again, at a new revision, when it
  turns uncertain five minutes after its last evidence, and a sync brings
  freshness up to date first. After a restart every stored session is
  `restartUncertain` until fresh lifecycle evidence. One limit: a sync provider
  cannot name the time the SDK stamps on its answer, a microtask after the core
  computed the records, so a record that turns uncertain within that
  millisecond can disagree with its envelope by one millisecond. The core's
  timer usually publishes the change first.
- **Approval recovery.** It answers `approval-recover` (#835), the old Hub's
  operator recovery, through agent-state's `recoverApproval`. The command's
  subject is the session's `id`, and its `expectedRevision` is the session
  record's `revision` that the operator read. The core retires the one approval
  marker without an attention ID that the session holds on `turnId`, only while
  the session's evidence is uncertain: five minutes without evidence, or since a
  restart. It commits before the reply and publishes `attention-cleared` with
  cause `recovered` and the session at its new revision, in the command's
  trace; no outcome follows. It refuses an unknown session with `not-found`, a
  record that changed since it was read with `revision-conflict`, a session
  with no such marker or with current evidence with `invalid-state`, and a full
  or failing store as acknowledgments are refused. The gateway sends it for an
  operator ([Gateway](#gateway)), and a remote part with the `control` scope may
  request it through the SDK edge.
- **Notice override** (#1009). Connections offers one confirmed **Clear this notice on every
  device** operator tool. The authenticated action route accepts `notice-clear` with `{noticeId,
  expectedRevision}` and the qualified session ID. The dedicated operator capability and tracker
  admit it; ordinary dispatch and raw SDK callers cannot. The core and owner guard the selected
  latest retained notice, and the core rechecks the record revision at save time. One owner save
  acknowledges every configured consumer atomically with matching completion, history, outcome and
  operation projection. Null selects a session with no notice; no-notice and already-acknowledged
  actions change no session state. Unknown sessions are `not-found`, changed selections are
  `revision-conflict`, and non-operators are `forbidden`. The synced record is the result; metadata
  acknowledgment proves neither provider readership nor physical-device success. Consumer
  self-acknowledgment stays unchanged. The session row clears from evidence and has no acknowledge
  button. Nothing automatically retries or replays an action after a lost answer, reconnect or
  restart.
- **Sessions tool.** Its manifest (module API 1.2) contributes the MCP read tool
  `core_sessions`: the sessions it holds at its revision, optionally only one
  provider's and those whose label, title, project or session ID contains `q`,
  ignoring case.
- **Sync and acknowledgment.** It serves `session` through sync, and answers
  `notice-acknowledge` through agent-state's `acknowledge` with `accepted`,
  `not-found` for an unknown session or notice, `invalid-request` for an unknown
  consumer, and `forbidden` when the sender's source does not end in that
  consumer ID: a consumer acknowledges for itself only. The acknowledgment
  commits before the reply, and the session's state at its new revision, in the
  command's trace, is its evidence; no outcome follows. The consumers are
  `DEFAULT_CONSUMERS` (`dashboard`, `nanoleaf` and `pixoo`). agent-state keeps that list with the
  store and refuses a store whose list differs, so changing it needs a
  migration.
- **Session labels** (#1006). The authenticated control action route and
  `core_send_command` accept `session-label-set`, targeting the qualified
  session ID with `{label, expectedRevision}`; null clears the label. The
  gateway uses a dedicated core capability; ordinary module dispatch and raw
  SDK grants cannot admit this family. The core checks the session revision
  at its owner save boundary and commits the user label, tracked completion,
  history and outcome together. A same user label or already-clear request
  completes without changing the session revision. A successful reply follows
  the commit; sync supplies record evidence. Pending outbox publication survives
  restart with the same message IDs, and the command is never sent again.
- **Action dispatcher and tracker** (#782, `src/core/tracker.ts`). Every device
  command, moment and mode change goes through one dispatcher: the gateway's
  [action routes](#routes) and MCP's `core_send_command`, and core automation,
  moments and the Hub mode, through `CoreHandle.dispatch`. It records the action
  as `sent` in the core store before it sends anything, so a full disk refuses
  it with `unavailable` and detail `storage-full` before any reply could say
  accepted. It sends the command once, as `bunny/core`, with its kind's reply
  deadline as its expiry, records the reply, and waits for the outcome until
  the kind's outcome deadline:

  | Kind | Families | Reply | Outcome |
  | --- | --- | --- | --- |
  | device | every command to one device, such as `power-set` or `playback-control` | 5 s | 30 s |
  | moment | `moment-play` | 5 s | 150 s: 60 s of lead and 60 s of tolerance at most |
  | mode | `mode-set` | 5 s | 60 s |

  The state machine is `src/core/operations.ts`: `sent`, then `accepted`, then
  `completed` with the outcome's result; or `rejected` (failed, with evidence
  `none`: a refusal proves no effect), `expired` (failed: still queued at its
  reply deadline) or `uncertain` (the handler had it at its reply deadline, or
  no outcome by the outcome deadline). A late outcome completes the record: a
  definitive one replaces `uncertain`, and history keeps both. A `succeeded`
  and a `failed` outcome for one action, in either order, keep both and leave
  it in `conflict` for a person. A request ID names one action, ever: the same
  caller asking for the same action again gets what it got, and anything else
  under that ID is `duplicate-conflict`. Nothing is ever sent again: not a
  timed-out command, not after a restart, which lets each pending action end
  `uncertain` at its deadline. A clean stop settles the dispatcher's own
  requests first: an action whose owner's handler has it with no reply ends
  `uncertain` at once ("the requester closed before the reply"), and one still
  queued ends failed with `cancelled`. Every step is logged once, in the action's trace:
  `command.queued`, `command.admitted`, `command.rejected` and
  `command.completed`. The tracker's rows, with every failed, expired, uncertain
  and conflicting result, are what #923 turns into inbox items.
- **Operation records** (Hub #922, `src/core/operation-records.ts`). The core's
  `operation` family is each tracked action's latest state, so a display such as
  the dashboard shows it requested, accepted and completed by syncing one
  family. It is the core's own first part (`CorePart`): each record is saved and
  published from the tracker's change, in that change's transaction, at the
  core's revision, and the core serves the family through its sync. A record is
  the tracker row's copy without the command's payload; the row stays the
  authority. `kind` is the tracker's existing category and deadline class, not
  proof of a physical target; `family` and `target` identify the action, including
  tracked core-local metadata changes. Evidence describes the action's transmitted
  or observed effect. After each tracked change, the family removes the oldest settled
  projections with reason `retired` until at most `MAX_OPERATION_RECORDS` (256)
  remain, or all remaining actions are pending. Pending records survive even
  above the limit; settlement and late outcomes restore the bound as they permit.
  The tracker and history are never pruned by this projection. Records outlive
  a restart, and a pending one turns uncertain at its deadline as the tracker's
  row does. State and removal messages retain the causal outcome trace, or the
  stored action trace when no outcome caused the change. The inbox (#923) points at
  an operation by its request ID.
- **Hub mode.** The core owns the durable `mode/2.0` record `hub` (#924), initially
  Free. An authorized `mode-set` saves the choice, checks its revision and
  completes the selection in one transaction, then independently dispatches
  native modes to the qualified admitted Nanoleaf and Pixoo devices. An admitted
  device remains a target after its module stops or fails; refused modules are
  excluded. The saved choice and each device's result remain separate. Startup,
  restart, duplicate submission and native changes send no application command;
  an explicit same-mode selection with a new request ID reapplies it. The
  dashboard and MCP's `core_set_mode` use ordinary control scope.
- **Outcome intake and acknowledgment.** The core takes every state, removal,
  occurrence and outcome another participant publishes. It drops a duplicate
  by `(source, id)` durably, since history keeps each whole message once, and
  refuses the same `(source, id)` with other content as `duplicate-conflict`,
  keeping it apart for diagnosis (the latest 1,000) with no change and no
  acknowledgment. An outcome advances the action whose request ID, target and
  command it matches. Once the outcome commits, the core acknowledges it with
  an `outcome-recorded` occurrence to its module, and acknowledges an exact
  duplicate again, so a lost acknowledgment recovers at the module's next start;
  a refused commit sends none, so the module keeps the outcome. Each intake's
  `message.received` record carries the incoming message's trace and span: INFO
  for an outcome, occurrence or removal taken, and for a duplicate outcome,
  which recovers an acknowledgment; a refusal at its code's level, so a full
  disk's `unavailable` is WARN. The intake commits in groups, at most 100
  messages or about 50 ms of its own work each, with a turn of the event loop
  between groups, so a burst never holds the runtime for a commit per message.
  Each message keeps its own verdict in its group, and a full disk refuses the
  group. A full intake queue loses what the bus drops, logged as
  `operation.failed` with `capacity`: an outcome comes again from its module's
  outbox, but an occurrence or removal is gone.
- **History** (`src/core/history.ts`). Private rows in the core store, with no
  time limit, written in the transaction that commits what they record: every
  removal, occurrence and outcome whole; each state change, the core's own and
  every module's, as a compact change event (what changed since the record
  history held, never a snapshot); and each step of a tracked action. A hook's
  raw observation and the acknowledgments are not kept: the session changes
  they cause are. The read API with filters and the timeline are #923's.
- **Extension point.** A `CorePart` (#923's inbox) creates its own tables in the
  core store, serves its families through the core's sync at the core's
  revision, derives rows from each committed core change and from each tracked
  action's change (`tracked`) in that change's transaction, and runs its own
  intake through the core's transactions and outbox. History keeps what a part
  publishes too.

## Core automation

The core owns event automation ([#925](https://github.com/jimmie-potts/agent-device-hub/issues/925)) in fresh private tables. It reuses the legacy Hub's event-rule definitions, interrupt set, quiet hours and budgets without transferring old rules or settings. `CoreModule.automation` exposes rule controls, settings, the interrupt set and the log for the authenticated gateway. A rule created without owner enabling stays disabled. The core runs independently of the page.

Triggers use source `core` and kind `attention-raised`, `attention-cleared`, `turn-ended` or `session-ended`. Intake accepts only an occurrence marked by its new committed reduction in this run. Sync, outbox republication, a duplicate and a restart acquire no such mark and start no moment. Deduplication is stored before evaluation; queued evaluations are not recovered or retried.

Arbitration retains no-flourishes, quiet hours, task and hourly budgets, device spacing, Quiet mode, the Work interrupt set and alert precedence. Each permitted target goes through the tracked dispatcher once, with a shared runtime-clock `startAtMs`. The private log's `receipt` means accepted, and `requestId` links to the current `operation`; an absent outcome is never completion or physical proof. Target IDs come from the host's admitted Nanoleaf/Pixoo participants, and current device records select their capabilities and mode. Unavailable or held devices are blocked.

The shared dashboard's Automation page manages these fresh rules and settings.
The gateway serves `/api/v2/automation/rules` (GET/POST), `rules/<id>`
(GET/PUT/DELETE), `rules/<id>/enable` and `disable` (POST with `{}`),
`interrupt-set` and `settings` (GET/PUT), and `log` (GET with optional `limit`
1–500 and `before` sequence). Success responses use schema `automation/2.0`.
Reads require read scope; all mutations require control and `bunny-request: 1`,
including client credentials. Rule bodies and interrupt sets are bounded to
8 KiB, settings to 1 KiB, and enable/disable bodies to 16 bytes. The gateway
rechecks the original request's authority immediately before changing state;
expected refusal codes leave the core running. A lost reply is never retried
automatically. Inspect the current rules/settings before another edit.

## Agent hooks

`bin/monitor-hook.mjs` is the 2.0 agent hook (#926): the hook command of Claude
Code and Codex, `node bin/monitor-hook.mjs <producer.json>`, with the hook's
JSON on stdin. For each hook it:

1. reads the client's existing lifecycle 1.x producer file, unchanged;
2. normalizes the hook with agent-state's normalizers: `normalizeHook`, or
   `enrichHook` for a producer that selected lifecycle 1.1 or 1.2;
3. turns the 1.x envelope into the 2.0 `lifecycle` observation that
   [MAPPING.md](../../packages/event-contracts/MAPPING.md#lifecycle-observation)
   describes;
4. publishes it as `org.bunny.lifecycle.observed` on
   `bunny.event.lifecycle.<session ID>` in one call to the gateway's SDK edge,
   with no stream, through the SDK's
   [`publishOnce`](../../packages/sdk/README.md#one-publication-without-a-stream).

The core takes it as it takes any hook observation. The hook's code is
`src/hook/`, which the package exports as `@jimmie-potts/runtime/hook`; it loads
none of the rest of the runtime.

- **The producer file.** The old hook's checks hold
  (`apps/hub/bin/monitor-hook.mjs`): an owner-only regular file with one link,
  read without following a link, of at most 8 KiB, with exactly `enabled`,
  `endpoint`, `qualified`, `source` and `token` and an optional
  `lifecycleVersion` of `1.1` or `1.2`; enabled and qualified; a token of 43
  base64url characters; and an endpoint
  `http://127.0.0.1:<port>/api/monitor/v1/events`. A `receipt.json` beside it,
  when there is one, must be private, installed and match it. The hook uses only
  the endpoint's host and port: the runtime keeps the Hub's port, 8788 (#835).
- **The credential.** The token authenticates as the producer's explicitly
  granted credential (or one from the optional legacy conversion). The Hub's
  setup named it `hub-` and the first 32 hex digits of the
  SHA-256 of the producer's source configuration without its hook name
  (`producerPrincipal` in `apps/hub/src/setup.ts`), and
  the runtime grant uses `bunny/parts/<that ID>` as its source. The
  hook derives the same source from the producer file (`producerSource`), so
  the file needs no new member. Its `ingest` scope lets it publish lifecycle
  observations and nothing else ([Grants at the SDK edge](#grants-at-the-sdk-edge)).
  Until grant operations exist (owner decision, 2026-10-07), a new producer is
  added by hand: `grantCredential` with that ID and source, its token's digest
  and `ingest`, then SIGHUP, then `GET /api/v2/authority?scope=ingest` with
  its token, which answers 200.
- **Bounded and fail-open.** Every path writes nothing, and every path but one
  exits 0 (see the next item): no output protocol, permission decision, retry,
  device or child process. A 2.9 s deadline, armed before anything loads, ends
  the process inside the clients' 3 s hook timeout whatever the runtime does,
  and the publication gets what is left of it. A stopped runtime, a refused or revoked credential, a lost answer,
  an unusable producer file or input the normalizers do not map end the hook
  quietly. The observation is then lost, as hooks fail open, and the session's
  freshness shows the gap. Input over 8 MiB is dropped.
- **A stalled file read.** For lifecycle 1.1 and 1.2, `enrichHook` reads the
  session's title from its transcript or Codex's `session_index.jsonl` and stops
  waiting after 100 ms, but an open on a stalled mount never returns, and on
  Node 24 `process.exit` waits for it. So the hook exits once no file read is
  under way, and if one still is at the deadline, it ends by `SIGKILL` instead.
  A check that cannot tell counts as no read, so the hook stays fail-open. That
  is the only path that does not exit 0; the clients treat a non-zero exit as a
  non-blocking error. Its observation was published first, unless the stall
  left no time for it.
- **Concurrency.** Each hook is a new Node process, and many at once share the
  CPU. In the failure-isolation review (2026-10-07), 5 sessions sending 20 hooks
  at once all landed, at 0.95 to 1.4 s at the median; 10 sessions sending 20 at
  once lost 21 of 200 at the deadline. The deadline leaves about 0.1 s before the
  clients' 3 s timeout.
- **Outcomes.** `publishOnce` says what may have happened: `published`;
  `rejected` with the edge's registry code, or `unavailable` when the edge was
  never reached, so nothing was published; or `uncertain-result` when the call
  reached the edge and its answer was lost, so it may have been. Nothing sends it
  again: the core drops a duplicate by `(source, id)` anyway, and the hook has
  nowhere to report either way.
- **Trace.** Each observation starts a new sampled trace, carried in the message
  and in the call's `traceparent` header. The core's `message.received` record
  of it carries that trace.
- **What leaves the hook.** Only what the normalizers' allowlist keeps: no
  prompt, response, tool input or transcript (#425), and the token only in the
  `authorization` header.

`node apps/runtime/scripts/measure-hook.mjs [--runs 25] [--stopped 5] [--silent 3]`
measures it from its start to its exit against a disposable runtime's edge: the
shipped entry point with the core, its gateway and one converted producer
credential, each hook a new Node process. On the WSL host (Ryzen 9 7950X, Node
24.21.0, 2026-10-07), 25 hooks through one session took 151 ms at the median
and 158 ms at worst, and the core accepted all 25. Against a stopped runtime
they took 153 ms, and against one that never answers 2.91 s, the hook's budget.
Most of it is starting Node and loading the hook's modules: the old Hub's hook
took 138 ms at the median against a stopped endpoint.

The [fresh setup procedure](SETUP.md) switches only the qualified hook link
during the owner-present cutover. The documented directory link, invoked as
`<link>/bin/monitor-hook.mjs`, points to the retained release's `apps/runtime`
directory. A separately qualified direct file link instead points to
`apps/runtime/bin/monitor-hook.mjs`. Keep the release and its dependencies in
place so the client's unchanged complete script path and
`@jimmie-potts/runtime/hook` resolve there. Until then the installed Hub keeps
its hook unchanged.

## Run

From the repository root, with Node 24, after `npm run build`:

```sh
node apps/runtime/dist/src/main.js --port 0 --state-dir ~/.local/state/agent-device-hub/runtime
```

| Argument | Meaning |
| --- | --- |
| `--port` | Required. The loopback port for health; 0 picks a free one. |
| `--state-dir` | The private state directory. Defaults to `~/.local/state/agent-device-hub/runtime`. |
| `--config` | The private [configuration file](#configuration), with each module's own section. Without it, a module that takes a configuration is refused. |
| `--lag-limit-ms` | How long the event loop may stay stuck before the process is killed. Defaults to 10000. |
| `--log-level` | `debug`, `info`, `warn` or `error`. Defaults to `info`. |
| `--environment` | `development`, `test` or `production`: every log record's `deployment.environment.name`. Defaults to `development`; disposable verification runs use `test`, and the installed runtime `production`. |
| `--simulate` | Build every module with its simulated transport, so the runtime reaches no device. Disposable verification runs use it. |
| `--edge` | Serve the [gateway](#gateway) on the health listener, for the client credentials that the configuration file's `edge` section names. It needs `--config`. |
| `--record-spans` | Write each finished span to a [bounded, private span file](#the-span-file) in the state directory. Disposable verification runs use it; the installed runtime does not, and keeps its spans in memory. |

Malformed arguments exit with status 2 and a usage line. Once the modules have
started, the process writes one line to stdout, `{"event":"runtime.ready","url":...}`.
SIGTERM or SIGINT stops every module and exits 0. SIGHUP reads the edge's
credentials file again ([Credentials](#credentials)). The entry point imports only
a small launcher that catches both signals before the rest of the runtime
loads. A signal that arrives while it loads exits 0 before anything is created.
One that arrives while the modules start is remembered: once their starts
settle, the runtime stops them all and exits 0, without a ready line. Only a
signal in Node's own startup, before the entry point runs (about the first
20 ms), takes Node's default action.

## Health

`GET /api/runtime/v1/health` answers 200 with a `runtime-health/1.0` document
while the process serves. Its `status` is `ok` when every module runs and the
lag check, if any, is active, and `degraded` otherwise. Each module has a
`state` (`refused`, `starting`, `running`, `stopping`, `stopped` or `failed`),
`healthy`, `syncRestarts` (how often an overflow restarted one of its sync
copies, so a restart loop shows), `serves` (the families it serves through sync
now, when it serves any) and, when refused or failed, a `reason` with a code
from the 2.0 error registry. A module's `name` gives its source on the bus,
`bunny/modules/<name>`, or `bunny/core` for the core. A consumer of a family
that several modules serve, such as `device`, syncs it from each module whose
`serves` lists it, by that source (#967). `lagCheck` is `off`, or `active` or
`stopped` with its `limitMs`. `memory` reports the whole process from
`process.memoryUsage()`.

Every request must name the listener as its host (`127.0.0.1:<port>` or
`localhost:<port>`, in any letter case, with the exact port), so a page on a
rebinding name reaches nothing. A health request also carries no `Origin` and
no `Sec-Fetch-Site` other than `none`, as the Hub and local controllers require.
Any other request answers 403 with the shared error body and `forbidden`.
Without an edge, every other route answers 404 with `not-found`; with one, the
[gateway](#gateway) serves every other route and checks each caller's own
context.

## Gateway

With `--edge`, the runtime's gateway (#835) serves every route of the health
listener but health, through `src/gateway/`. It follows
[ADR 0012](../../docs/decisions/0012-bunny-event-platform.md): every refusal is
the shared error body with a code from the 2.0 registry, at the HTTP status that
fits its code, and every route carries only its major version. It serves once
every module has started; until then, and from the start of a stop until the
listener closes, its routes answer 503 with `unavailable`, so a remote part that
reconnects never syncs from a module still starting. `runtime.started` says
whether the edge is configured (`bunny.edge`); `runtime.edge.serving` follows
once it serves, with the number of credentials (`bunny.grant_count`).

The gateway listens on the runtime's port. At the cutover (#840) that is the old
Hub's port, 8788, so the bookmark, hook endpoints and producer files keep their
address.

### Callers

Two kinds of caller reach the gateway, and each acts as one source with the old
Hub's scope names. No caller is limited to some devices. Fresh setup grants
only the owner's explicitly selected scopes, whose runtime meaning covers all
devices. The optional legacy conversion reports widened grants
(see [Credentials](#credentials)); fresh setup does not use it.

- **A client credential**, from the edge's [credentials file](#credentials),
  presents its bearer token from outside any browser page: a request with a
  token must carry no `Origin` and no `Sec-Fetch-Site` other than `none`, so a
  page can never use a credential. A made-up or revoked token answers 401 with
  `unauthenticated`; a page that presents one answers 403 with `forbidden`.
- **A browser session** acts as `bunny/parts/dashboard`, the dashboard's grant
  (#922), with `read` and `control`; no credential may act as that source. The `bunny-session` cookie carries it
  (`HttpOnly`, `SameSite=Strict`, eight hours, at most 16 sessions, the oldest
  ending first). A session that ends without a logout, evicted by the
  seventeenth or at its expiry, ends its streams at once, as a logout does.
  Only this origin's own pages, and the browser itself for a navigation or
  bookmark, may present it: another site's `Origin` or `Sec-Fetch-Site`
  answers 403 with `forbidden`, and a change (any method but GET or HEAD) must
  name this origin and carry `bunny-request: 1`.

"This origin" is the one the request names: `http://` and its `Host`, either
`127.0.0.1:<port>` or `localhost:<port>`, so a bookmark on
`http://localhost:8788/` signs in and changes things as one on `127.0.0.1` does
(Hub #276), and a page on the other loopback name is another origin. A cookie
does not separate ports: the browser sends `bunny-session` to every port of
that loopback name, so another local app on another port receives it. It is
good only here, and a program on the machine could reach the runtime anyway.
When a request carries several cookies of the name, the gateway takes the one
that is a live session.

A browser signs in two ways, with the same checks: the request comes from this
origin's own page, names it in `Origin` and carries `bunny-request: 1`.

| Route | Signs in |
| --- | --- |
| `POST /api/v2/browser/launch` `{"code"}` | With a launch code from the launcher. The runtime serves the launcher's socket, `bunny-launch.sock` in its state directory, owner-only, which hands each connection the runtime's origin and a code that is good once for 30 seconds (at most eight wait). `requestBrowserLaunch(stateDir)` asks for one; the dashboard's launcher (#922) opens the browser with it. A configuration whose edge section sets `"launcher": false` serves none, as a disposable run does, whose state directory is too deep for a socket; a socket path over 107 bytes refuses the start with `launcher-path-too-long`. |
| `POST /api/v2/browser/session` `{}` | Without a code, when the edge section sets `"browserAccess": "trusted-loopback"` (Hub #276's opt-in); otherwise 404. |
| `POST /api/v2/browser/logout` `{}` | Ends the cookie's session and its streams, and clears the cookie. |

The session's token travels only in `Set-Cookie`, never in a body or record.

### Grants at the SDK edge

Remote parts make the SDK calls over SSE and HTTP under `/api/sdk/v1/`, through
#883's `RemoteEdge` on the modules' bus. The gateway admits each call's caller
and hands the edge the permissions its scopes give (`edgePermissions`):

| Scope | Calls | Routing keys |
| --- | --- | --- |
| `read` | `subscribe`, `sync` | every state and event key, `bunny.state.*.*` and `bunny.event.*.*` |
| `ingest` | `publish` | lifecycle observations only: the `lifecycle` family on `bunny.event.lifecycle.*` |
| `control` | `request` | the core's operator commands only, `bunny.cmd.approval-recover.*` and `bunny.cmd.notice-acknowledge.*`; every other command goes through the [action routes](#routes) |
| `admin` | none | none: the old Hub's `quiesce` is dropped with the supervised migration |

So a hook's credential, with `ingest` only, can publish lifecycle observations
and nothing else: a command, a read, a subscription, or another family's message
on a lifecycle key is refused with `forbidden` before anything reaches the bus.

A device module keys its records and messages by the device's routing ID, which
the profile's routing-ID rule (ADR 0012's key shape) makes the last token of
each key. That rule binds a message to its key: a command's `subject` must be its
key's last token, which the SDK's bus checks on every transport and refuses with
`invalid-message` before any responder has it; so must a state or removal,
wherever it is published, and a message a remote part publishes, which the edge
checks. A grant for `bunny.cmd.*.lamp-1` can then never act on `lamp-2` through a
command whose subject names it, and a record never reaches a reader of another
entity's key.

No scope lets a remote part respond to commands or serve a family yet; a remote
owner's grant comes with its own story. The core's dispatcher decides what a
remote grant may request directly (#782, `DIRECT_COMMANDS`): the core's own
operator commands. A device's command, a moment, a mode change and a module's
own family, module-internal ones included, are `forbidden` at the edge, so no
action bypasses tracking. The edge also:

- refuses a token used under another declared source (the SDK client sends
  `bunny-source`) with `forbidden` at connect;
- remembers each command it hands its bus, by source and message ID, and
  refuses the same message again with `duplicate-conflict`, so a raw HTTP client
  cannot make a responder run it twice. It remembers a command while its bus
  has it, and once settled until its `expiresat`, at most 10 minutes; one the
  bus refused before any responder had it is forgotten at once, since sending
  it again is safe. Each credential and each browser session may have 1,024
  remembered at once, each source 4,096, so the browser sessions, which share a
  source, can never fill more than that however often they sign in, and all of
  them 135,168, which every source the runtime admits (32 credentials and the
  sessions) fits at its bound. Past any, that caller's next command is
  `capacity` while another source's still goes through. A runtime restart
  forgets them;
- writes a heartbeat comment on each stream every 15 s, and ends a stream whose
  socket stays full for 30 s, its reader having stopped: its subscriptions free
  their queued messages, and the reader reconnects and syncs again if it ever
  reads. The SDK client takes a stream that stays silent for 45 s as lost.
  `RuntimeOptions.edge.liveness` changes these limits for tests.

The edge checks every remote message against profile 2.0, the core families,
the device families that every device module answers (#918) and the modules'
own schemas (each factory's `schemas`), and logs
`runtime.edge.connected` and `runtime.edge.disconnected` (WARN with `capacity`
for a stream it ended because its reader stopped), `runtime.edge.refused` and
`runtime.edge.failed`.

### Routes

| Route | Scope | Answers |
| --- | --- | --- |
| `GET /api/v2/families/<family>` | `read` | `{"schema": "family-read/2.0", family, records}`: every record of a core, device or module state family. A family that several modules serve, as every device module serves `device` (#967), reads as one answer of each owner's records, in the order the owners started. Each comes from the gateway's copy of that owner's records, which it syncs on the first read and keeps following (at most 32 copies). An owner that is down, or whose copy cannot be read, never fails the others: `unavailable` names each such owner by its source, always present and empty when every owner answered, so a reader never takes its records for absent. A family whose every owner is down or unreadable is `unavailable`, and one whose only owner refused answers that owner's code. Never polled: the owner publishes each change. A malformed name is `invalid-request`, an unknown family `not-found`, a family no module in this runtime serves or served `not-found` too, which a retry does not change, one whose module has failed or stopped `unavailable`, and an owner's refusal its code with fixed text for that code, never the owner's detail. |
| `GET /api/v2/snapshot?families=<a>,<b>[&owner=<source>]` | `read` | The snapshot read API (ADR 0012, "Portability"): `{"schema": "snapshot-read/2.0", families, revision, records: {<family>: [...]}}`, one owner's families at its revision, from one sync, with no copy kept. `&owner=<source>`, such as `bunny/modules/lifx`, names the owner, as a family that several modules serve needs; a named owner that does not serve every named family is `not-found`, and one that is down `unavailable`. Families of more than one owner are `invalid-request`, which says to name families of one module. It is the gateway's one-off sync, the second implementation of the read API that the ADR asks for, for a caller of this one process. A record belongs to the family its schema names, at any version. |
| `GET /api/v2/modules` | `read` | `{"schema": "module-list/2.0", moduleApiVersion, modules}`: each module's state, `serves`, the families it serves through sync now, as health lists them (#922), since a browser cannot read health, and, once it is admitted, its pages, MCP tools and whether it shows settings. |
| `GET /api/v2/modules/<name>/settings` | `read` | `{"schema": "module-settings/2.0", module, settings, describedBy}`: what the module's `settings.show` picks from the configuration `configure` accepted, never a secret. |
| `POST /api/v2/modules/<name>/upload` | `control` | API 1.3 declared binary upload. Exact query fields are `family`, `target`, `requestId` and `name`; the body is nonempty `application/octet-stream`, bounded by the module's limit of at most 10 MiB. Prepares module-owned input, then dispatches its existing command through the core with the supplied request ID. Returns the ordinary `command-reply/2.0` or shared refusal. |
| `GET /api/v2/links` | `read` | `{"schema": "links/2.0", editors, places}`: the editor links of the devices and the place links, from the edge section. |
| `GET /api/v2/authority?scope=<scope>` | any | `{"schema": "authority/2.0", scope}` when the caller holds the scope, else `forbidden`, as an operator checks a producer's credential with its token (#926). |
| `POST /api/v2/commands/approval-recover` | `control` | Sends `approval-recover` to the core as the caller's source, with `{session, turnId, expectedRevision, requestId?}`, and answers `{"schema": "command-reply/2.0", status: "accepted", requestId}` or the core's refusal. A request whose fate the bus cannot know is `uncertain-result`. |
| `POST /api/v2/commands/<family>` | `control` | An action (#782): one device's command, a moment or a mode change, `{target, data, requestId?}`, sent through the core's dispatcher as `bunny.cmd.<family>.<target>` for the caller's source, so it is tracked. Its type, `org.bunny.<entity>.<verb>.requested`, and schema, `<family>/2.0`, follow from the family, and it is checked against the family's schema first, as the edge checks a remote message: invalid input is `invalid-request`, a family whose schema the runtime does not know `not-found`, the core's own operator commands `invalid-request`, and nothing is tracked or sent. It answers `{"schema": "command-reply/2.0", status: "accepted", requestId}`, the owner's or the bus's refusal, such as 503 `unavailable` for a known family that no running module answers, which is tracked and recorded failed, `uncertain-result`, which is never retried, or `unavailable` without the core. A request ID already used for the same action answers what that action got; for another, `duplicate-conflict`. |
| `GET /modules/<name>/<page>` | `read` | A declared page. Passive HTML keeps its restrictive policy. API 1.3 React pages redirect to their shared-shell route; trusted editors load their declared bundles under the policy below. |
| `GET /modules/<name>/content/<ref>` | `read` | The module's content by reference: an image, plain text or JSON of at most 16 MiB. API 1.3 supports bounded query fields and safe returned refusals; earlier modules refuse queries. |
| `GET /modules/<name>/assets/<asset>` | `read` | A finite declared API 1.3 build asset: JavaScript, CSS or a supported static image, at most 16 MiB. No caller-selected path or user upload becomes an executable asset. |
| `GET /`, `/dashboard.js`, `/dashboard.css` | none | The [dashboard](dashboard/README.md) (#922), the old Hub's paths, built into `dist/dashboard/`. It holds no secret and loads without a session, so the page can sign in: from this origin's own pages, a bookmark or the launcher, and `/` also from a link on another local app's page with the same host name, a same-site top-level navigation to a document (Hub #561). Another site's `Origin` or fetch metadata, a frame or fetch from another local app, and any of them for the assets are `forbidden`; another method `not-found`, a query `invalid-request`, and a runtime whose dashboard is not built answers `not-found`. Each answer refuses framing, sends `Cross-Origin-Opener-Policy: same-origin`, and a policy that runs only the page's own script and style and connects only to this origin. |
| `/mcp` | client credentials | [MCP](#mcp). |
| `/api/sdk/v1/*` | per call | The SDK edge, above. |

API 1.3 content queries allow at most 16 distinct keys, each 1–64 characters,
with values of at most 512 characters. The module validates its closed query
set. Its read signal ends on completion or the five-second deadline. Returned
refusals expose a registry code with fixed text, without failing the module or
returning private error details. Pixoo uses SQL catalog pages within 256 KiB
and separate PNG preview references; these reads leave cached compatibility
evidence unchanged.

Uploads use the same unsafe-request checks as commands. The gateway rechecks
the caller after reading the body and again after preparation, before dispatch.
The module receives a bounded preparation signal and finalizes its temporary
input from the dispatcher reply and owner outcome. Reusing an accepted request
ID does not send another command. Cleanup failures preserve the known reply;
uncertain work is never resent. Uploads do not increase the 16 KiB command JSON
limit and are never served as executable assets.

A module's pages, assets, content, settings and tools are every reader's. A module is
called only while it runs (otherwise `unavailable`), within 5 s (otherwise
`unavailable`). A contribution that throws
fails its module, as a handler that throws does, and answers `internal`. A page,
settings, content or asset of any type, image bytes included, or tool answer that holds
a secret a module read is never served: `internal`. A tool's refusal is checked too, its detail
included.

The authenticated module catalog gives every page its `id`, `title`, exact
same-origin `path` and `presentation`: `passive`, `react` or `trusted-editor`.
New feature UI source belongs to its module and is compiled into the shared
React shell, which owns navigation, common UI/style, connection handling and
authenticated API access. Its browser entry never imports the Node module
registration. A component URL redirects to `/#/module/<name>/<page>` only while
the module runs; the shell also requires a matching built component.
Module packages opt in with an explicit `./frontend` export whose named
`frontend` contribution follows `@jimmie-potts/sdk/frontend`. The existing
esbuild step collects these static imports through its build-only
`@bunny/module-frontends` module. Nothing discovers or imports a frontend URL
at runtime. The shared shell supplies authenticated reads, tracked command
attempts, common components and module-scoped sync on its existing connection.

Reviewed existing editors may use declared bundles. The gateway wraps their
markup with declared module scripts and styles. Their policy allows same-origin
scripts, styles, images and authenticated reads, plus inline styles for existing
renderers; it forbids external scripts, eval, inline script handlers, forms,
base URLs and nested frames. Only the shared origin may frame a module page.
Such a scripted frame is trusted application code, not an untrusted extension
sandbox. Passive pages still cannot run scripts. Assets require authentication,
have `no-store` and `nosniff`, and resolve only by declared identity. Uploaded
media stays on the separate non-executable content route. Reads run no commands;
every edit still needs the command boundary's control permission and tracking.

The `/api/v2` documents have no published JSON schemas yet. The dashboard
validates the catalog and shows a family read's `unavailable` owners, such as a
device module that is down, rather than treating their devices as absent.

A module counts as a family's owner only once it has served the family. This is
a known limit: a module that never served, refused at admission or failed in its
start before it first served, is not counted. A combined read such as
`/api/v2/families/device` then answers the other owners with `unavailable: []`,
and a family only that module would serve reads `not-found`. A reader such as the
dashboard therefore cross-checks module health: `/api/v2/modules` lists each
module's state, `refused` or `failed` included.

### MCP

`/mcp` serves MCP through `packages/mcp`, unchanged, only when the edge section
sets `"mcp": true`, as the old Hub served it only with its `mcp` set; otherwise
it answers 404 with `not-found`. It serves client credentials only: a browser
session is told so with `forbidden` first, and a page's `Origin` is refused
before MCP sees the request. Each module's read tools come from its manifest,
as `<module>_<tool>`, and the core contributes `core_sessions`; a credential with
`read` lists and calls those of every module. With `control` it also gets
`core_recover_approval`, which sends `approval-recover` to the core as the
credential's source, and `core_send_command` (#782), `{family, target, data,
requestId?}`, which sends a device's command or tracked session label through the core's dispatcher, as
the action route does. A
tool's result is `{kind: "extension", data: {result}}`, and a refusal
`{kind: "extension", data: {error}}` with the shared error body and
`isError: true`. The refusals the MCP package makes itself, before a tool runs,
such as arguments a tool does not take, keep its released 1.x `gateway-error`
result with the registry's code and no detail: an exception to the shared error
body, since the issue reuses the package unchanged. MCP's own protocol errors,
such as an unknown tool, keep the MCP specification.

### Retired routes

`src/gateway/retired.ts` maps every route of the old Hub, in
`apps/hub/src/server.ts` and its route modules, to its 2.0 replacement or the
reason it is dropped, and names the story that delivers each replacement. A
test parses the Hub's sources and fails on a route the map lacks. A request to
an old route answers 404 with `not-found`, whose detail names the replacement,
and is logged as `runtime.edge.refused` with its route template in `http.route`
and its method in `http.request.method`, never the path's values, for the
retirement story's check (#839).

### Records

A refusal's record holds `bunny.route` (one of the edge's calls, `stream`, or
`other` for a gateway route), `http.route` and `http.request.method` for a
gateway route, `bunny.participant` when the caller was admitted, `bunny.code`
from the error registry and `bunny.reason`, the diagnostic contract's
registered reason for that code. `internal` and `uncertain-result`, whose
effect may have happened, have none. A refusal takes its code's level from the
SDK's one table: a refusal a correct caller should never receive
(`unauthenticated`, `forbidden`, `too-large`, `duplicate-conflict`) or lost
capacity (`capacity`, `unavailable`) is a warning, `internal` is an error, and
a validation refusal is INFO. A refusal that repeats with the same route, code
and caller is logged once, then once a minute with `bunny.attempt_count`
counting the repeats, until a quiet minute. A refusal never holds its detail,
which may quote what the caller sent. The edge answers an exception it did not
expect with fixed text, never its message: `internal`, or `uncertain-result`
once it has handed a command to the bus; it logs one `runtime.edge.failed`
record at ERROR with only its route, its caller's source, that code and
`error.type`, and after dispatch the command's routing key, request and message
IDs and trace.

No token, launch code, session token or digest reaches a record, an answer,
health or a span. The gateway's tests and every disposable run scan for the
synthetic token prefix `tok_SYNTHETIC835`.

`runMain`'s `onEdge` option hands the caller the edge once it serves. A
verification run's child uses it to end a part's stream, as a lost connection
would; the shipped entry point does not pass it.

### Credentials

The configuration file's `edge` section names a private credentials file,
`edge-credentials/1.0`:

```json
{"schema": "edge-credentials/1.0", "credentials": [
  {"id": "hub-0123456789abcdef0123456789abcdef", "source": "bunny/parts/hook-claude", "digest": "<SHA-256 of the token, lowercase hex>", "scopes": ["ingest"]}
]}
```

It follows the configuration file's private-file rules, at most 64 KiB, and
holds at most 32 credentials, each with a distinct ID, digest and source, a
source that is not the core's (`bunny/core`), a module's
(`bunny/modules/<name>`), the runtime's own (`bunny/runtime/...`) or the browser
sessions' (`bunny/parts/dashboard`), and distinct scopes from `read`, `control`,
`ingest` and `admin`. A credential has no other member: one that names
`devices` is refused, never read wider than it was written. It holds no token: a
caller's token is compared with each digest in constant time. The
runtime refuses to start with `edge-config-missing` (no edge section),
`edge-credentials-missing`, `edge-credentials-not-private`,
`edge-credentials-invalid` or `edge-credential-source` in `runtime.failed`; no
refusal quotes the file.

Credentials are granted, revoked and rotated by changing the file, as today:
`grantCredential(file, credential)` and `revokeCredential(file, id)` rewrite it
whole and owner-only, as an operator adds a producer's credential by hand until grant operations exist ([Agent hooks](#agent-hooks)), and
`writeEdgeCredentials(file, credentials)` writes the selected credentials. Each
writer holds the file's lock, `<file>.lock`, which names its process: writers in
one process take turns, so a grant and a revocation made at once both take
effect, and a writer in another process is refused with
`edge-credentials-busy`. A writer creates the lock with its content in one step
and removes only a lock it created. A lock whose process has gone is taken over
in one step that moves it aside; if what it moved is not the lock it judged, a
fresh one another writer just took, it puts that back and refuses with
`edge-credentials-busy`. The temporary files a crashed writer left are removed. A writer reads the file, writes its new
one beside it under a name of its own and renames it over the file only if the
file still holds what it read; a change made meanwhile, such as an edit by hand,
refuses the write with `configuration-changed` and stands. A grant of a
credential the file holds as it is changes nothing; one whose ID the file holds
with another digest, source or scopes, or whose source another
credential has, belongs to another owner and is refused with
`edge-credential-conflict`, as the old setup authority refused. To rotate a
token, revoke the credential and grant it again.

SIGHUP, or `Runtime.reload()`, reads the file again: a new credential is taken,
and one revoked or changed has its streams ended and its next call refused with
`unauthenticated`. A SIGHUP while the runtime still starts is kept and runs once
the gateway serves. A file the runtime refuses keeps the credentials it had.
Each reload logs one `runtime.edge.reloaded` record: INFO with `bunny.outcome`
`succeeded` and the count, or ERROR with `failed` and the refusal's
`error.code`. Automatic rotation is not built.

The optional `convertHubEdge(hubConfig)` utility converts an old Hub
configuration offline. [Fresh setup](SETUP.md) does not run it or import the
old credential inventory. When separately selected, each converted credential
keeps its ID, digest and scopes,
and acts as `bunny/parts/<its ID in routing form>`, so the token its client
holds authenticates unchanged; one called `dashboard` acts as
`bunny/parts/dashboard-credential`, since the browser sessions' source is theirs
alone. Its device grant is dropped. The Hub limited `read` and `control` to the
devices a credential named, and the runtime limits neither, so the conversion
returns `widened`: the ID alone of each credential with `read` or `control`,
which now reads or commands every device, for the owner to review before using
the conversion. `browserAccess`, `mcp`, `editorLinks` and `placeLinks` become the edge
section's, checked as the runtime's reader checks them. It refuses, with
`convert-invalid`, IDs that would share a source, editor links that are not
routing IDs, and links or counts the runtime would refuse, which the owner fixes
first.

## Configuration

With `--config <file>`, the runtime reads one configuration file before it
serves (Hub #919). It holds each module's own section, by module name, and the
edge's section (#835):

```json
{
  "schema": "runtime-config/1.0",
  "modules": {
    "sign": {
      "greeting": "hello",
      "signs": [{"id": "sign-1", "address": "192.0.2.10"}],
      "secrets": {"token": "/home/owner/.config/agent-device-hub/secrets/sign-token"}
    }
  },
  "edge": {
    "credentials": "/home/owner/.config/agent-device-hub/secrets/edge-credentials.json",
    "browserAccess": "trusted-loopback",
    "mcp": true,
    "editorLinks": {"sign-1": "http://127.0.0.1:9100/editor"},
    "placeLinks": {"kitchen": "http://127.0.0.1:9200/"}
  }
}
```

The `edge` section names the [credentials file](#credentials) by its absolute
path and keeps the old Hub's `browserAccess` (only `trusted-loopback`),
`editorLinks` (at most 16, by device routing ID) and `placeLinks` (at most 8,
with a port, never `bunny`): loopback `http` links without credentials, query
or fragment. `"launcher": false` turns the launcher's socket off, and
`"mcp": true` turns [MCP](#mcp) on. `--edge` needs the section; anything else in
it refuses the file with `config-invalid`.

The file follows the [state](#state) rules: an absolute path off `/mnt`, no
link anywhere along it, outside every Git checkout, and a regular file with one
link and no permissions for group or others, owned and readable by the
runtime's user, of at most 1 MiB. The runtime opens the file's last part without
following a link, then refuses it unless the file it opened, as `/proc/self/fd`
shows, is the one at the path, so a directory swapped for a link after the
checks is refused too. The operator chooses the paths of this file and the
secret files; the runtime does not check the modes of their directories. It has only
`schema`, `modules` and `edge`. Otherwise the runtime
refuses to start, before it serves, with one of these codes in `runtime.failed`:
`config-relative`, `config-mount`, `config-missing`, `config-link`,
`config-checkout`, `config-not-file`, `config-not-private` (a file the runtime's
user may not read, or one under a directory it may not search, included),
`config-too-large` or `config-invalid`. No refusal quotes the file.
[Fresh setup](SETUP.md) writes a new file from the owner's explicit choices,
without copying or converting old configuration. There is no reload: a change
takes effect when the runtime restarts.

Before it starts the modules, the runtime admits each one in list order with
the SDK's `checkConfiguration`, against its own section only. A section for a
module the runtime does not host is ignored. A module is refused, never
started, and shown in health as `refused` with a registry code and a fixed
detail, while the others start, when:
- it declares `configure` and the file has no section for it (`not-found`), or
  there is no file;
- its section is not a JSON object, or its `secrets` member does not map at most
  16 names to absolute paths (`invalid-request`);
- its `configure` refuses the section, with the refusal's code and detail, or
  throws (`internal`);
- it names a device that is not a routing ID, or one that a module before it
  already named (`invalid-request`);
- a secret file its section names is missing (`not-found`), is not private by
  the rules above, not readable by the runtime's user or under a directory it
  may not search (`forbidden`), or is larger than 64 KiB or not UTF-8 text
  (`invalid-request`).

The core (#831) declares no `configure`, so it needs no section. A malformed
`core` section refuses the core, and the runtime then ends as it does when the
core fails.

Its `runtime.module.refused` record carries `bunny.code` and the `manifest`
phase, and, for a `configure` that threw, the error's type. A module then gets
its configuration as `config`, reads only the secret files its section names
with `secrets.read(name)`, which checks the file again on every read, and keeps
its own files in `files()`. A module never sees another module's section or
secrets through its context; a module's own code is not sandboxed, as the
[module API](../../packages/sdk/README.md#secrets) explains, which also says
what each read refuses.

No secret reaches a log record, health or an error body. The runtime logs no
part of the file and no secret, and refusals carry fixed text. One registry of
the secrets modules read serves every writer in the process: the runtime's
writer drops, and counts in `runtime.stopped`, any record whose attribute holds
one, as text or as a number's digits. The process's `runtime.failed` record and
the runtime's records of a module's refusal, failure or stop problem leave such
an error attribute out instead, so the record is still written without it, and a
module's span leaves it out too, keeping the span for its children. Its tests and every disposable run
scan records, health, error bodies and proof for the synthetic token
`tok_SYNTHETIC919`.

## State

The state directory is created owner-only (mode 700) when it is missing. The
runtime refuses a relative path, a path under `/mnt`, a path inside a Git
checkout, a path with a link anywhere along it (including a dangling one), a
file, and a directory that others can open. It checks the whole path before it
creates anything, so a refused path creates nothing, and it never creates
through a link. Each module's SQLite file is `modules/<name>.sqlite` in it, mode
600, created when the module first calls `database()`. The runtime opens it
with the SDK's `openModuleDatabaseFile` (Hub #972), as the module test kit
does:
- In WAL mode at `synchronous = FULL`, so each commit syncs its log once and is
  durable when it returns. SQLite keeps the log in `<name>.sqlite-wal`, beside
  the file and with the same mode. `synchronous = NORMAL` would skip the sync,
  and a power loss or a stopped WSL VM could then undo a committed outcome or
  an accepted command's record, which ADR 0012 rules out.
- With exclusive locking, so the module keeps the file to itself while it runs
  and SQLite keeps the log's index in memory, with no `<name>.sqlite-shm`.
  Opening the database therefore needs no new space, and a start on a full disk
  opens it. Another connection to the file, such as a second runtime's or the
  `sqlite3` shell's, is refused with `SQLITE_BUSY` until the module stops. The
  runtime never opens an existing module file outside SQLite: closing such a
  descriptor would drop every POSIX lock the process holds on the file, this
  one included. It checks the file with `lstat` and creates a missing one with
  `O_EXCL`.
- A database first created on a full disk cannot take WAL mode, whose header it
  cannot write, and keeps SQLite's rollback journal at the same level until the
  module opens it again with room.

A clean stop checkpoints the log into the file and removes it. After a crash
the file alone may lack commits that are still in the log, so copy a stopped
store with its `-wal` file, or use SQLite's backup API; a copy of the file
alone can lose them. Beside the file, the module's
private folder `modules/<name>/` is created with mode 700 when the module first
calls `files()`; a `modules` directory or folder that is a link, belongs to
another user or that others can open is refused with
`module-folder-not-private`.

## Offline tools

Tools that change a module's files require the runtime to be stopped.
The migration utilities below remain available for a separately selected
import; the [fresh setup procedure](SETUP.md) uses empty state and runs none
of them. Their examples and synthetic scenarios describe the utilities, not
a required cutover step.

### The runtime's lease

`holdRuntimeLease(stateDir)` (`src/lease.ts`) takes the
[core's lease](#agent-session-core), the exclusive transaction on
`modules/core.sqlite-owner`, without waiting, and holds it until `release()`.
It refuses with `runtime-running` while a runtime, or another tool, holds it,
and with `lease-unavailable` when the lock file is not a regular file private
to the user. It creates `modules/` and the lock file, owner-only, when they are
missing, as the core does, and writes nothing to the lock file. A tool holds
the lease for as long as it runs: a runtime that starts meanwhile waits for it
until its core's three-second deadline, fails with `core-failed` and is
restarted by its service manager. The Pixoo library migration and the Nanoleaf
migration ([#933](https://github.com/jimmie-potts/agent-device-hub/issues/933))
take it.

### A fresh module

`freshModule(stateDir, name)` (`src/state.ts`) says whether a module has
nothing in the state directory yet: no `modules/<name>.sqlite`, log or journal,
and no folder or an empty one. It creates nothing. Like `openModuleFolder`, it
refuses with `module-folder-not-private` a `modules/` or module folder that is
a link, belongs to another user or that others may open. Both migrations call
it before they create anything and again under the lease, so each refuses such
a folder with exit 3 and nothing written
([#1003](https://github.com/jimmie-potts/agent-device-hub/issues/1003)).

### Pixoo library migration

The Pixoo library migration ([#931](https://github.com/jimmie-potts/agent-device-hub/issues/931))
carries the Pixoo service's library into the [Pixoo module's](../../modules/pixoo/README.md#library-migration)
store. Run it with Node 24 from the repository root, after `npm run build`:

```bash
node apps/runtime/dist/src/migrate-pixoo.js migrate --library <PIXOO_DATA_DIR>/library --state-dir <state dir> [--min-free-bytes <bytes>]
node apps/runtime/dist/src/migrate-pixoo.js verify --library <PIXOO_DATA_DIR>/library --state-dir <state dir>
```

Both paths are absolute. `--library` is the directory that holds the service's
`catalog.sqlite`, which the tool only reads; `--state-dir` is the runtime's
state directory. `migrate` writes the Pixoo module's `modules/pixoo.sqlite`
and `modules/pixoo/` there, through `openModuleDatabase` and
`openModuleFolder`. It runs the database's last checkpoint itself and closes
the database before it reports, so no log is left beside the file. `verify`
compares them with the library, as `migrate` left them, before the runtime's
first start: the start writes the module's own tables. Each holds the
library's owner lock and the runtime's lease while it runs. Each writes one
JSON line to stdout, `{"schema": "pixoo-migration/1.0", "operation",
"result", ...}`, with counts, codes and SHA-256 digests only: never a path, a
name or a file's content.

The line is the tool's own record, and its codes are the tool's own, outside
the 2.0 error registry, as the health document `runtime-health/1.0` is the
runtime's: no message crosses the bus while the runtime is stopped. A caller
that separately selects this utility reads the line and exit code. The fresh
setup in #935 does not invoke it or use its result as a cutover gate.

A refusal creates nothing: the tool checks the library, the state directory,
the module's files and the free space before it makes anything. Only then does
`migrate` create the state directory and the runtime's lease file,
`modules/core.sqlite-owner`, when they are missing, as the runtime would, and
check the module's files again under the lease. `verify` creates nothing.

`migrate` needs each file it copies and each folder it makes in whole blocks of
the file system, the source catalog's size twice (an upper bound on the
carried rows in the database and in its log), and the space it keeps free:
`--min-free-bytes`, 256 MiB by default.

A first SIGINT or SIGTERM stops the tool. Before it writes, it refuses with
`interrupted`. While it writes, it stops every copy, removes what it wrote and
fails with `interrupted`. While it verifies, it refuses. A second signal stops
it at once. A signal that arrives after the tool has written its line changes
nothing: the process exits with the code the line reports.

| Exit | `result` | Meaning |
| --- | --- | --- |
| 0 | `migrated`, `verified` | Done; `verified` has zero mismatches |
| 1 | `mismatch` | `verify` found mismatches: `mismatches` counts them by kind |
| 2 | `refused`, code `usage` | Malformed arguments |
| 3 | `refused` | Refused before writing anything; `code` and `message` say why |
| 4 | `failed` | `migrate` stopped after it began to write, once every copy had finished; `destination` is `removed` (the module's database, log, journal and folder are gone again) or `left` |

| Code | Exit | Refusal or failure |
| --- | --- | --- |
| `usage` | 2 | Malformed arguments |
| `runtime-running` | 3 | A runtime, or another tool, holds the state directory's lease |
| `lease-unavailable` | 3 | The lease's lock file is not a regular file private to the user |
| `disk-short` | 3, 4 | Less free space than the space it needs (3), or the file system or the database filled up while it wrote (4) |
| `destination-not-empty` | 3 | The module already has files. Migrate into a fresh state directory, or remove every path the tool creates: `modules/pixoo.sqlite`, `modules/pixoo.sqlite-wal`, `modules/pixoo.sqlite-shm`, `modules/pixoo.sqlite-journal` and `modules/pixoo/` |
| `destination-missing` | 3 | `verify` found no module database |
| `module-folder-not-private` | 3, 4 | `modules/` or `modules/pixoo/` is a link, belongs to another user or others may open it, as the runtime's [State](#state) rules refuse (3); or, only if the module's folders change under the tool while it holds the lease, `openModuleFolder` refuses them as it writes (4) |
| `state-dir-*` | 3 | The runtime's [State](#state) rules refuse the state directory |
| `source-missing` | 3 | The library path is missing, is not a folder, or holds no `catalog.sqlite` |
| `source-in-use` | 3 | The Pixoo service holds the library: stop it first |
| `source-not-clean` | 3 | The catalog's log or journal holds commits the file lacks, or the library has no `owner.sqlite`: start and stop the Pixoo service once, so it folds its log in and creates the file |
| `source-schema` | 3 | Not the installed release's schema version 3, or its tables differ from it |
| `source-corrupt` | 3, 4 | The catalog fails SQLite's checks or names a missing, linked or oversized file (3), or a copy does not match the hash its catalog gives (4) |
| `destination-not-clean` | 4 | The module's database kept a log or journal with content after the tool closed it |
| `interrupted` | 3, 4 | SIGINT or SIGTERM: before it wrote (3), or while it wrote (4) |
| `module-db-not-private` | 4 | Only if the module's files change under the tool while it holds the lease: the runtime's [State](#state) rules refuse the database it creates |
| `internal` | 3, 4 | Anything else |

A refusal and a failure name no path or value. The tool never retries; a
failed `migrate` is run again only into a fresh destination. A `migrate`
killed with SIGKILL, or by a power loss, leaves an incomplete destination:
`verify` counts its mismatches and `migrate` refuses it, and the operator
removes the paths `destination-not-empty` lists.

### Nanoleaf migration

The Nanoleaf migration ([#933](https://github.com/jimmie-potts/agent-device-hub/issues/933))
carries the Nanoleaf bridge's preferences into the
[Nanoleaf module's](../../modules/nanoleaf/README.md#migration) store and
folder. It also turns the bridge's registry into the module's section of the
[configuration file](#configuration), with each device's token in a secret
file. Run it with Node 24 from the repository root, after `npm run build`:

```bash
node apps/runtime/dist/src/migrate-nanoleaf.js migrate --source <bridge state dir> --state-dir <state dir> --secrets-dir <secrets dir> --section <section file>
node apps/runtime/dist/src/migrate-nanoleaf.js verify --source <bridge state dir> --state-dir <state dir> --secrets-dir <secrets dir> --section <section or configuration file>
```

Every path is absolute.

- `--source` is the bridge's private state directory, with its
  `status.sqlite`, `config.json`, `layout.json` and scene files. The tool only
  reads it, and holds a read lock on `status.sqlite` and on the bridge's
  worker, registry and layout locks while it runs, so no bridge process
  changes it meanwhile.
- `--state-dir` is the runtime's state directory, which `migrate` creates when
  it is missing. `migrate` writes the module's `modules/nanoleaf.sqlite` and
  `modules/nanoleaf/` there, through `openModuleDatabase` and
  `openModuleFolder`, and closes the database before it reports, which folds
  its log into the file.
- `--secrets-dir` is a private directory (mode 700, created when missing) where
  `migrate` writes each device's token, alone and without a line break, as
  `nanoleaf-<device>-token`, mode 600.
- `--section` is the private file where `migrate` writes the module's section,
  which names those files. A caller using this utility puts it under `modules.nanoleaf` in
  the configuration file. Its directory must be private too. `verify` also
  takes the configuration file itself and reads the section there.

`verify` compares the store, the folder, the section and every secret file
with the source. It reads each secret through the runtime's own secret reader.
Both operations hold the runtime's lease and write one JSON line to stdout,
`{"schema": "nanoleaf-migration/1.0", "operation", "result", ...}`, with counts,
codes and SHA-256 digests only: never a token, an address, a path, a name or a
file's content. Its fields:

- `counts`: what the source holds for the registered devices. `devices`;
  `projects`; `palette` (the colors chosen); `elements` (each element's project
  and halves); `mapSettings`; `pendingEdits`; `favorites`; `deviceState` (the
  carried `meta` values: each device's mode, its two revisions and its native
  overrides); `layouts` and `scenes` (files' entries); `qualifiedSources`;
  `codexMetadata` (0 or 1); `secrets`.
- `leftInBackup`: what stays only in the backup. `sessions`; `taskRows` (task
  details, activity, waits, receipts and the shared-input task tables);
  `reservations`; `comets`; `locates`; `displayCaches`; `controllerLedger`
  (every device's); `integrationRequests`; `legacyBackup` (1 when the
  shared-input row holds the legacy task backup); `bindings`; `otherMeta`
  (the `meta` values that start fresh: epochs, receipts, caches, holds,
  failures); `unregistered` (the rows, `meta` values, layout entries and scene
  files of devices the registry no longer names).
- `mismatches` (`verify`): `database` (the file is missing, not private,
  unclean, not the module's schema or fails SQLite's check); one count per
  carried kind, `projects` to `deviceState`, for each row missing, extra or
  different by its key; `startFresh` (a row in any table that is not carried, a
  `meta` value that is neither carried nor the schema's, or a `shared_input`
  row other than the fresh one); `layout` and `scenes`; `unexpected` (anything
  else in the module's folder, or a folder that is not private);
  `configuration` (each section member, and each device, that differs, and
  each device listed twice); `secrets` (a file the runtime's reader refuses,
  or whose own bytes are not the token alone); and `total`.
- `digest`: SHA-256 over the carried rows (`store`), the written files
  (`files`) and the section (`configuration`), with each secret named by its
  file's name, so two migrations of one source into other folders give the
  same line.

| Exit | `result` | Meaning |
| --- | --- | --- |
| 0 | `migrated`, `verified` | Done; `verified` has zero mismatches |
| 1 | `mismatch` | `verify` found mismatches: `mismatches` counts them by kind |
| 2 | `refused`, code `usage` | Malformed arguments |
| 3 | `refused` | Refused before writing any of the module's data, secrets or section; a refusal before the lease creates nothing. `code` and `message` say why |
| 4 | `failed` | `migrate` stopped after it began to write, on a failure or a signal; `destination` is `removed` (the module's database and folder and the files it wrote are gone again) or `left` |

A signal that arrives before the tool installs its handler, in its first few
hundred milliseconds and before it creates anything, ends the process by that
signal, with no line. A signal that arrives after the tool has written its
line changes nothing: the process exits with the code the line reports. Any
exit but 0 is a no-go.

| Code | Exit | Refusal or failure |
| --- | --- | --- |
| `usage` | 2 | Malformed arguments |
| `runtime-running` | 3 | A runtime, or another tool, holds the state directory's lease |
| `lease-unavailable` | 3 | The lease's lock file is not a regular file private to the user |
| `destination-not-empty` | 3 | Something the tool writes is already there: `modules/nanoleaf.sqlite` or its `-wal`, `-shm` or `-journal` file, or a non-empty `modules/nanoleaf/`, in the state directory; a `nanoleaf-<device>-token` file in the secrets directory; or the section file. Remove them, or migrate into fresh ones |
| `destination-missing` | 3 | `verify` found no module database |
| `paths-overlap` | 3 | The state directory, the secrets directory or the section's folder lies inside the source directory, or the source inside one of them |
| `secrets-dir-refused`, `section-dir-refused` | 3 | The secrets directory, or the section file's directory, is not private, or is inside a Git checkout, on `/mnt` or reached through a link |
| `state-dir-*` | 3 | The runtime's [State](#state) rules refuse the state directory |
| `module-folder-not-private` | 3, 4 | `modules/` or `modules/nanoleaf/` is a link, belongs to another user or others may open it, as the runtime's [State](#state) rules refuse (3); or, only if the module's folders change under the tool while it holds the lease, `openModuleFolder` refuses them as it writes (4) |
| `module-db-not-private` | 4 | Only if the module's files change under the tool while it holds the lease: the runtime's [State](#state) rules refuse the database it creates |
| `source-missing` | 3 | The source directory, its `status.sqlite` or its `config.json` is missing |
| `source-in-use` | 3 | A bridge worker, enrollment or another writer holds the source: stop the bridge's services and workers first |
| `source-not-clean` | 3 | `status.sqlite` has a journal to roll back: start and stop the bridge once, so it rolls it back |
| `source-schema` | 3 | `status.sqlite` is not model version 4 in rollback journal mode, or a table the migration reads has another column |
| `source-corrupt` | 3 | `status.sqlite` fails SQLite's check, or `config.json`, `layout.json`, a scene file or a lock file is damaged, too large, a link or not a regular file |
| `source-config` | 3 | The registry is malformed, a device has no private IPv4 address or no token the runtime can read back, or the module refuses the converted section |
| `source-device-id` | 3 | A registered device ID is not a routing ID, which the configuration requires |
| `source-not-configured` | 3 | The bridge never configured shared input, so no qualified source names the sessions the wall shows. On the bridge, run `nanoleaf shared-configure --config <file>` with a shared-input configuration that names the qualified sources (codex-nanoleaf's `docs/shared-input.md`), then migrate again. This utility requires a separately qualified source; the `linux-state-v4` fixture as it is gets this refusal. Fresh setup does not invoke the utility |
| `disk-short` | 3, 4 | The disk filled while `migrate` wrote, its final checkpoint included |
| `destination-not-clean` | 4 | A log or journal with content was left beside the module's database after `migrate` closed it |
| `interrupted` | 3, 4 | A first SIGINT or SIGTERM stopped the tool: before it wrote (exit 3), or once it had written (exit 4: the database with its log and journal, the folder, the secret files and the section removed, and the one `failed` line written). A second signal stops it at once |
| `internal` | 3, 4 | Anything else |

`migrate` checks its arguments, the three output paths, the destination with
its `modules/` and `modules/nanoleaf/` folders, and the source before it
creates anything, so every refusal but the lease's creates nothing. Then it
takes the lease, which creates the state directory, `modules/` and the lease's
empty lock file as a runtime's start does, and checks the destination and its
folders again under it. A failure after that leaves those and the secrets and
section folders, empty.

`migrate` checkpoints the module's log into the file before it closes it,
because the close's own checkpoint keeps the log on a full disk without an
error. Its writes run one after another, so none is still running when a
failure removes what was written. A refusal and a failure name no path or
value. The tool never retries; a failed or killed `migrate` is run again only
into fresh destinations. Run
`verify` before the runtime's first start: the module writes its own rows when
it starts, which `verify` would count.

## Failure isolation

A device's errors and timeouts are not module failures. Under policy A in
[ADR 0012](../../docs/decisions/0012-bunny-event-platform.md), a module opens
only local resources in `start`, reaches its device lazily and turns those
errors into outcomes and an `unavailable` device state. The
[module test kit](../../packages/sdk/README.md#module-test-kit) fails a module
whose start waits on a device that never answers, and the fixture sign shows
the pattern. A failed worker call is the module's to handle, too: it never
fails the module. An error that escapes a module stops only that module, and health
shows it `failed` until the runtime restarts; nothing restarts it
automatically. That covers:
- a start that throws, rejects or outlasts the start deadline (10 s);
- a subscription handler or responder that throws;
- a `scheduler.after` callback that throws or rejects;
- an uncaught error in a module's worker thread;
- an error that escapes to the process from the module's own async flow.

To stop a module, the runtime aborts its `signal`, cancels its timers and
closes its participant. That settles the module's own pending requests, closes
its sync copies and owners, and waits only for its own running handlers, so it
never waits on another module's handler. Then it calls `stop()`, terminates its
workers and closes its database. The close and `stop()` each have a 5 s
deadline; after the first, `stop()` runs even if a hung handler is still
running. A failed module stays stopped until the runtime restarts.

The whole stop runs in the module's own async flow, wherever the failure was
noticed. An error that the module's abort listeners or cleanup throw or reject
therefore stays with that module; it never fails the module that published the
message, nor the runtime's stop.

An error that escapes to the process from code outside every module is the
runtime's own failure: it writes a `runtime.failed` record and exits 1. So does
a failed start. A refusal the runtime makes itself names its reason in
`error.code`, so the journal says why a restart keeps failing:

| `error.code` | Refusal |
| --- | --- |
| `state-dir-relative` | The state directory is not an absolute path. |
| `state-dir-mount` | It is `/mnt` or under it. |
| `state-dir-checkout` | It is inside a Git checkout. |
| `state-dir-link` | A link, even a dangling one, is anywhere along it. |
| `state-dir-not-directory` | It, or a part of it, is a file. |
| `state-dir-not-private` | Others can open it. |
| `posix-host-required` | The host has no POSIX user IDs. |
| `module-db-not-private` | A module's SQLite file is a link, or not a private file with one link that the runtime's user owns. |
| `config-relative`, `config-mount`, `config-missing`, `config-link`, `config-checkout`, `config-not-file`, `config-not-private`, `config-too-large`, `config-invalid` | The configuration file; see [Configuration](#configuration). |
| `port-invalid` | The port is not an integer from 0 to 65535. |
| `edge-config-missing`, `edge-credentials-missing`, `edge-credentials-not-private`, `edge-credentials-invalid`, `edge-credential-source` | The edge's section and credentials file; see [Credentials](#credentials). |
| `launcher-path-too-long` | The launcher's socket path in the state directory is over 107 bytes; see [Callers](#callers). |
| `core-failed` | The [agent-session core](#agent-session-core) failed, such as on a store it cannot read or a lease another runtime holds. |

A Node error keeps its own code, such as `EADDRINUSE` for a health port in use.

## Event-loop lag check

A blocked event loop or memory exhaustion affects every module, so the process
cannot contain it. The service manager restarts the whole runtime instead. The
main thread counts a beat on a timer, and a watchdog worker thread checks the
count. A worker keeps running while the main thread is stuck, which a timer on
the main thread cannot do. When the beats stop for the lag limit, the worker
writes a `runtime.stuck` record to stderr and kills the process with SIGKILL.
Exiting suits systemd better than refusing health, because systemd does not
poll HTTP. The unit needs `Restart=on-failure`, which restarts after a failure
exit and after an unclean signal such as SIGKILL.

Time in which the watchdog itself did not run, because its wait overran, is
not counted. That covers a pause of the whole process, such as SIGSTOP or a VM
paused while its host sleeps: the main thread could not beat either. A stuck
main thread is still caught once the watchdog has been awake for the limit. A
watchdog thread that ends without being asked logs `runtime.watchdog.stopped`,
and health shows `lagCheck.status` `stopped` and `degraded`.

The worker costs about 14 MiB of resident memory: the runtime's VmRSS with and
without it, from `scripts/measure-memory.mjs`, measured before the core shipped.

## Logs

Each record is one JSON line on stderr and a
[diagnostic-contract](../../docs/observability-contract.md#the-runtimes-records-profile-12)
record of profile 1.5, built by the contract's `createRecord`: `schema_version`,
`timestamp`, the severity pair, a registered `event_name` with its static
`body`, the resource, the scope and its version (`1.0.0`), and registered
`attributes` with `bunny.provenance` `source`, plus `trace_id`, `span_id` and
`trace_flags` when the record has a trace. The resource is service `runtime`
in namespace `bunny`, `service.version` (the package's version), a
`service.instance.id` that each process draws once and shares with its
watchdog thread, and `deployment.environment.name` from `--environment`.
Maintenance intake reads these lines with the contract's validator. Beside the
stdout ready line, which keeps its own contract, the process writes a
`runtime.ready` record. `runtime.started` and `runtime.edge.serving` carry the
listener's port (`server.port`), never its URL, and `runtime.stopped` counts the
records the writer dropped (`bunny.telemetry.dropped_count`) and the sink lost
(`bunny.telemetry.failure_count`), with the spans lost.

The runtime's own records have scope `bunny.runtime`. A module's records have
the one scope `bunny.module` and the attribute `bunny.module`, which names the
module and which the module's own fields cannot replace. A module may log only
the events the catalog registers for modules, with registered attributes: the
runtime drops a record with another event or a value outside its registered
type, and leaves out fields the catalog does not register. The
[module test kit](../../packages/sdk/README.md#module-test-kit) fails a module
that logs either, and a new event goes through a catalog change. A dropped
record is counted, never truncated.

A failure record names the error's type (`error.type`) and, when it is an
identifier, its code (`error.code`). As the contract requires, it never holds
the raw message or stack, which may quote a URL with a token in it. A module's
refusal or failure carries its 2.0 registry code in `bunny.code` and where it
arose in `bunny.phase`: `manifest`, `start`, `handler`, `timer`, `worker` or
`async` (its own async flow). A problem in its stop carries `bunny.phase` and no
code: `handlers` (its participant's close) or `stop`, or, for an error after it
stopped, where that error arose. A refusal of a malformed name leaves the name
out.

A sink that fails never changes what the runtime does: a sink that throws loses
the record, and a closed stderr, which reports EPIPE, is ignored. The watchdog
thread writes its `runtime.stuck` record with the runtime's resource, and still
kills the process when stderr is closed.

A subscription whose full queue drops deliveries gets one
`runtime.delivery.dropped` warning at once. While drops go on, one more
warning a minute carries their count, so a storm cannot flood the journal. A
minute without drops ends that, and the next drop is logged at once again.

## Decision records and spans

The bus records each decision once, where it is made (ADR 0012's
"Observability", #949). The runtime connects the SDK's `onDiagnostic` on its
bus and its edge to its log, as records under `bunny.runtime` at the level the
SDK set:

| Record | Level | When |
| --- | --- | --- |
| `runtime.command.admitted` | INFO | The bus put a command in its owner's queue. |
| `runtime.command.refused` | WARN, its code's level | No responder, a full queue, an expiry in the queue or a closed responder. |
| `runtime.command.cancelled` | INFO | Its requester closed or stopped waiting before a handler started it. |
| `runtime.command.replied` | INFO; its code's level for a typed refusal, so ERROR for `internal` | The owner replied, `accepted` or with its typed refusal. |
| `runtime.command.uncertain` | WARN | A handler had it and the request ended `uncertain-result`. |
| `runtime.sync.served`, `runtime.sync.refused` | INFO; its code's level for a refusal | A sync request's answer. |
| `runtime.sync.restarted` | DEBUG | An overflow restarted a copy's sync. |

A command's records carry its requester (`bunny.participant`), its routing key
(`bunny.routing.key`), its request and message IDs, the outcome, any registry
code with its reason, and the command's own trace, from a module or a remote
part alike. A request ID that `bunny.request.id`'s 1.x pattern refuses is left
out of a record or span, which keeps the rest. A module's records come from its
own code and SDK helpers under `bunny.module`: its outbox's `outcome.published`
and `outbox.deferred`, and `device.unavailable` and `device.available` from
`DeviceAvailability`, which logs one degradation and one recovery for a polled
device that stays offline.

The runtime records spans through the observability package's
`createHostDiagnostics`, with tracing on, 100% head sampling that honors a
parent's sampled flag, no exporter and the adapter's bounded local span sink;
it installs no process context manager. The bus records each command's
`bunny.command.request`, `.queue` and `.execute` spans under `bunny.runtime`, and
`trace.start` records a module's own spans under `bunny.module` with its name.
Each finished span goes to `RuntimeOptions.spans` as one projected OTLP JSON
document; without that option the runtime keeps the latest 1,024 for
`runtime.spans()`, which returns them oldest first with the count of older
spans it evicted, so a span missing from memory was evicted only while that
count is above zero. Nothing exports them yet (#813). `runtime.stopped` counts spans
lost as invalid, dropped, unfinished at shutdown or failed in the sink, with the
records. If the adapter cannot start, the runtime runs without recorded spans
and logs one `runtime.tracing.failed` record at ERROR with `error.type`.

### The span file

With `--record-spans`, or `spans: 'state-file'` in `RuntimeOptions`, each finished
span goes to a file pair in the state directory instead of memory, so a process
outside the runtime can read the spans, and a crash keeps those it had finished
(#950; a disposable run's supervisor reads them for its
[follow query](verify/README.md#follow-one-request)).

- `spans.ndjson` is the segment being written and `spans.previous.ndjson` the one
  before it. Each segment holds at most 512 spans or 2 MiB, so the pair holds the
  latest spans, up to 1,024 (at least 512 unless spans are large, since each segment also rotates at 2 MiB),
  within the contract's 4 MiB queue bound. The next
  segment replaces the segment before it.
- A segment starts with one header line, `{"schema":"runtime-spans/1.0","evicted":N}`,
  that counts the spans let go before it. A reader can tell a span that was let go
  from one that never arrived, as `runtime.spans()` does for memory. A runtime
  that restarts on the same state directory continues the same files. If a kill
  came between starting a segment and writing its header, so that the current
  segment is missing or empty beside a previous one, the next header says
  `"evicted":null`: the count is unknown, never 0, and it stays unknown for the
  files' life.
- Both files are owner-only (mode 600), opened without following a link, and must
  be regular files with one link; any other file, the previous segment included, is
  refused with `span-file-not-private`, and the runtime does not start.
- A span that cannot start a segment, because the rename or the open fails, is lost
  and counted. The next span tries again, so recording resumes once the cause has
  gone.
- A span the file cannot take, because it is closed or the disk refuses it, is
  lost and counted in `runtime.stopped` like any other span the sink fails to
  take. A reader returns each complete line that is a span and counts a complete
  line that is not. A last line with no newline is a write in flight, or one that a
  kill cut short; it is never returned, a runtime that continues the file ends it
  first, and the reader then counts it as not a span.

## Memory

`node apps/runtime/scripts/measure-memory.mjs` measures the shipped runtime with
no configuration file, so the core alone, with each device module refused, for [#123](https://github.com/jimmie-potts/agent-device-hub/issues/123): three
runs, sampled at 5, 15, 30 and 60 s after the ready line. Add
`--variant no-lag-check` to measure it without the watchdog thread, or
`--variant simulated` to measure it with every shipped module running on its
simulated devices, configured with its factory's simulated section. It needs a
build and a TMPDIR outside every Git checkout.

`node apps/runtime/scripts/measure-edge-memory.mjs` measures the edge under a
stalled reader (#835): the shipped core and its gateway, a reader that
subscribes to large state messages and stops reading, and a module that
publishes 2,000 messages of 64 KiB with distinct content. It collects garbage
before each sample and reads the runtime's memory before the messages, while
the reader is stalled, and once the 30 s stall limit has ended the stream.
`--messages`, `--kib`, `--stall-s` and `--runs` change it.

## Commits

`node apps/runtime/scripts/measure-commits.mjs` measures the SQLite commits the
runtime makes on its event loop, for [#123](https://github.com/jimmie-potts/agent-device-hub/issues/123)
and [#972](https://github.com/jimmie-potts/agent-device-hub/issues/972): the
commits per observation or command, the time the loop spends in SQLite and the
event-loop delay. Its `intake` scenario runs the core alone and publishes hooks'
lifecycle observations at 20 a second for 30 s; `lifx` sends 20 power-set
commands to the LIFX module on simulated bulbs, each waiting for its outcome;
and `outbox` runs the SDK's outbox alone, as a module that stores a pending
state and then a state, an outcome and a pending count, with a stand-in core
acknowledging each outcome. `--scenario`, `--seconds`, `--rate`, `--commands`
and `--runs` change them; by default each scenario runs three times. The probe
wraps `node:sqlite` in its own process. It counts as a commit a `COMMIT`, or a
write outside a transaction that changed a row, on a module database, and as a
synced commit one that waits for the disk, a commit that ran a WAL checkpoint
included. It reports commit times for synced and unsynced commits apart, and
checkpoints with their own count and times. The blocked time is the time spent
in SQLite calls only: serializing or cloning a payload outside SQLite is not in
it. The event-loop delay window opens once the delay monitor's timer has run.
The delay's percentiles are meaningful for `intake`, whose load is paced by
timers; the other two run each command as one chain of promises, so a stall
shows only in their maximum. It needs a build and a TMPDIR outside every Git
checkout.

## Fixture modules

A module is created by a factory that takes its device transport,
`create<Name>Module({transport})`, so a test or a disposable run passes a
simulated device and no hardware is touched (#846). The fixture modules show
the convention. There is no manifest slot or registry for transports, because
ADR 0012 rules out a plug-in framework.

`tests/fixtures/lamp.ts` holds the lamp, the stand-in device module that later
stories build on. `createLampModule({transport})` takes a `LampTransport`.
`SimulatedLamps` is the simulated one: it keeps its state across runtime
restarts, as a real lamp would, and a test can hold its switches or make the
next one fail. The lamp passes the
[module test kit](../../packages/sdk/README.md#module-test-kit):
- it serves its lamps (family `lamp`) through sync, and their `device/2.0`
  records, which say only that each is a lamp, as every device module serves
  `device` for its own devices (#918, #967);
- it copies the core's `mode` and `session`, keeps the lamps off in quiet mode,
  and shows on its indicator whether a session waits for a person;
- it switches a lamp on `bunny.cmd.lamp-switch.<id>`, its family named as ADR
  0012 names commands, so the core's action route reaches it, refusing an
  unknown lamp with `not-found`;
- it accepts a command whose `requestId` it already handled from the same
  source, a duplicate, and changes nothing;
- it switches the device in a `bunny.device.call` span, the command's child,
  and gives the device no trace context;
- it reports each switch through its [outbox](../../packages/sdk/README.md#outbox),
  which records the outcome's publication and forgets the outcome once the core
  acknowledges it: the lamp's new state, the `org.bunny.lamp.switched`
  occurrence and the outcome. When the lamp cannot be reached, the outcome is
  `failed`, with evidence `none` and the `unavailable` error.

`lampSchemas` holds its payload schemas, and `lampSpec()` its kit description.
`tests/fixtures/chime.ts` holds a consume-only module,
`createChimeModule({transport})` with `SimulatedChime`. It follows the core's
sessions and rings once for each approval prompt. It records what it rang in
its own SQLite file, so a restart with the prompt still waiting does not ring
again. It passes the kit as a module that only copies.

`tests/fixtures/sign.ts` holds the sign, the configured stand-in for a device
module with settings, a secret and private files (#919).
`createSignModule({transport})` takes a `SignTransport`; `SimulatedSigns` starts
offline, never answering, and accepts only the synthetic token. Its
`configureSign` takes a greeting, the signs' IDs and addresses, and its token's
file as `secrets.token`. Its start reads the token, keeps its layout in its
private folder, serves its signs (family `sign`) and their `device/2.0` records,
and returns without reaching a sign. It then reaches each sign on the runtime's
scheduler with a 1 s deadline, to show the greeting it rendered with a worker
call: a sign that does not answer is `unavailable` and is tried again with
capped backoff, and one that shows the greeting is `available`. It publishes
each change of a sign's availability as the sign's state and its device record.
A render that fails, past its deadline included, is no evidence about the sign:
its availability stays as it was, the failure is logged against the sign with
the call's code, and the attempt is tried again. It logs each change and each
run of failed renders once, not each attempt. `signSpec()` runs it through the
kit, policy A's check included.
Under module API 1.2 (#835) it contributes the page `preview`, which shows its
signs and refers to its preview, `content/preview.png`, by reference; that
content, a 1-pixel PNG; the read tool `status`, each sign's availability; and its
settings, the greeting and the signs that `configureSign` accepted, never the
token.

`tests/fixtures/core.ts` hosts the real core with its mode owner, tracker, inbox,
history and outcome acknowledgment. It adds only the catalog's panel consumer
and the optional publication hook. Core changes commit in its store and go out
through its outbox. The lamp fixture accepts unanswered synthetic mode commands
at `fixture-hub`, separately from the real owner's `hub` target.

`tests/fixtures/gadget.ts` holds a scripted device module for the tracker's
tests: it answers `gadget-set` as each test scripts the command, holds it, or
reports more outcomes later, through its own outbox.

A process test kills the runtime between the lamp's commit and its publish,
then restarts it twice. At the first restart the lamp sends its state,
occurrence and outcome, the core takes the outcome once and acknowledges it,
and the lamp forgets it. The second restart sends nothing, and nothing ever
sends the command again.

## Scenario catalog

`tests/scenarios/catalog.ts` is the runtime's one scenario catalog (#846). Each
scenario says what a person or a device should see, as a seed and named steps.
The seed names the modules to start and the families the reader copies, one copy
per owner. A copy of a family that several modules serve, such as `device`,
names its owner, `{owner: 'bunny/modules/lamp', families: ['device']}`, and
`reader.states(family, owner)` reads that owner's copy alone (#967). A step acts
through the harness, expects an observation within a time bound, or expects one
to hold. A failed step names what it observed and stops the scenario. Each run
type has one execution adapter that runs the same definitions unchanged:
`tests/scenarios/memory.ts`, the in-memory harness (tier 1, in CI), and the
[disposable runs](verify/README.md) of #920 (tier 2), whose run adapter is
`verify/adapter.ts`. The catalog holds the core's and the fixture modules'
scenarios, and collects each registered module's from its own file under
`tests/scenarios/modules/`, after the core's, in file-name order (#999).
The dashboard's two core scenarios live in `tests/scenarios/dashboard.ts`,
with their own fixture identities and unread-policy assertions (#922).
The core operation-record scenario lives in `tests/scenarios/operations.ts`.

The in-memory harness hosts the seed's modules in the runtime's module host,
each built with its simulated transport, a registered module through its
registration's `simulation`, on a manual clock and scheduler. Each scenario runs twice. Its parts (a hook, an operator, a panel
and a reader) first join the host's bus, then reach it through the runtime's
[gateway](#gateway) on 127.0.0.1, each with a run-generated client credential
whose grant the catalog's `GRANTS` sets: the hook may only publish lifecycle
observations, the reader may only read, and the operator and the panel read,
request the core's operator commands and send device commands through the
core's dispatcher. Each harness also grants the agent hooks' converted
producer credential (`PRODUCER`, with `ingest`) and writes its unchanged 1.x
producer file, naming the gateway's port, for the [hook script](#agent-hooks),
which the harness's `hook` runs as a client's hook command does, if asked while
the runtime is stopped (#926). The gateway's HTTP routes serve both runs, through the
harness's `gateway` call, as a part, a browser signed in by a trusted loopback
page, a stranger with a made-up token or a caller with none, and its `dispatch`
call sends an action on the action route (#782). A crash between the lamp's commit
and its publish abandons the runtime and starts a new one on the same state
directory behind the same port, as the service manager would restart it.
Simulated devices keep their state across the crash. The harness can also lose
the core's next acknowledgment to the lamp on its way, so the lamp reports that
outcome again at its next start.

The catalog holds:
- an approval prompt reaching every module;
- a command with a tracked outcome, sent through the core's dispatcher, and a
  failed one in the inbox;
- a module failing while the others continue;
- a part reconnecting and syncing, with nothing replayed;
- the runtime starting with zero modules;
- the agent-session core alone: sessions from hook observations, an approval
  prompt raised and cleared, a finished turn kept on its session record with no
  inbox item, a notice acknowledged by a consumer for itself only, a runtime
  end, and a restart that leaves the sessions uncertain until fresh evidence;
- the early end-to-end path: a hook observation, the committed session, the
  simulated device's update, a tracked action, its outcome, history and inbox
  rows, then sync and read. It adds the same action sent again, which the core
  answers itself without sending it, a failed command whose inbox row the
  reader reads, the deadline answers with a late outcome that completes an
  uncertain record, a disconnect, a crash-restart and a lost acknowledgment,
  which the core takes as a duplicate and acknowledges again;
- a configured module, the sign, starting while its sign is offline, reporting
  it unavailable and showing its greeting once it is online;
- a module whose configuration is invalid refused while the core runs on;
- the [playback module](../../modules/playback/README.md) (#929) following the
  speaker the phone plays to: the HT-A9 alone, then the Move; a pause that
  reaches the presented speaker only; a Move that goes silent mid-song, so the
  record turns stale with its song kept and a command is refused `unavailable`,
  with one degradation and one recovery logged; and a command the Move never
  answers, `uncertain` in history and the inbox and never sent again. A part
  whose grant may only read may not command them, and neither may the
  operator directly: every command goes through the dispatcher. Time
  is real in a disposable run, so the step to `unavailable` at 30 s is left to
  the module's own tests;
- the LIFX module (#928) with a simulated pendant and Beam: the pendant follows the
  core's sessions in Work, painting once per change, a restart writes nothing to
  it, Free never paints it, a color command reaches it, and once it is switched
  off at the wall it shows unavailable and a command to it ends uncertain in the
  inbox; the Beam has no controls and gets no packet, and no address leaves the
  module. A part whose grant may only read may not command them, nor the
  operator directly, and every reader reads both bulbs;
- the [Tidbyt module](../../modules/tidbyt/README.md) (#930) on a simulated
  cloud: an idle start writes nothing; the status tile follows the core's
  sessions, and a burst of changes inside the 15-second gate makes one later
  push of the latest state; the now-playing tile follows the playback module's
  record through play and pause, behind its own gate, and leaves the rotation
  when the music stops; a restart while the song's card has stood past its gate,
  with the Move answering 400 ms late, neither removes nor pushes the card, and
  the status rows come back dimmed as uncertain; the reader holds the Tidbyt's
  device record with no control; and neither the API key nor the cloud device
  appears anywhere. The simulated cloud shows each tile as text rows, and the
  scenario compares them with the frames the reader's own copies call for;
- the gateway (#835): a part reads sessions on `/api/v2`, through the snapshot
  read API and through the `core_sessions` MCP tool, and every refusal is a
  registry code: a malformed or unknown family, a made-up or missing token, a
  credential or browser session used from another site, a hook reading, and a
  route of the old Hub, logged with its route;
- a token outside its grant refused (a hook's command, a reader's, and the
  operator's lamp command, which goes through the dispatcher), a recovery whose
  subject names another session than its key refused as `invalid-message`, a
  hook's message of another family on a lifecycle key refused and heard by
  nobody, and a notice acknowledgment a raw HTTP client sends again refused as
  `duplicate-conflict`, with the core running it once;
- an operator recovering an approval that a restart left uncertain, through
  `POST /api/v2/commands/approval-recover`, after a stale revision is refused;
- a module's page, the preview it loads by reference, its settings and its MCP
  tool served from its manifest, with the page refused without a session and
  the settings refused to the hook, which may not read;
- the Pixoo (#843), with its simulated Pixoo and the playback module (#929),
  whose record Now Playing follows, so none of the Pixoo's syncs is refused:
  - Monitor following the core's sessions (`pixoo-monitor`);
  - declared React pages, passive bounded catalog/preview/settings reads, a
    tracked playlist edit and read-only refusal (`pixoo-pages`);
  - a media command accepted, then completed once the media reached the device
    (`pixoo-media`);
  - a Now Playing card from the playback module's presented speaker, popping up
    over Monitor without dimming, then holding a whole takeover of Media for
    more than 30 s while the song plays on unchanged (`pixoo-now-playing`);
  - a start while the device is offline, with one degradation and one recovery
    (`pixoo-offline`);
- the Nanoleaf wall (#844): the core and the Nanoleaf module with a simulated
  Lines controller, read by owner, `device` alone included, following an agent
  session onto a Line and its finished turn,
  taking Work, Quiet and Free with tracked outcomes, refusing an unsupported moment and an
  animation outside Free, showing the power the wall reports, and showing the
  wall unavailable while it does not answer, logged once each way. Quiet sent
  meanwhile succeeds as observed, since a mode is the module's own state, and holds
  nothing, so once the wall answers it shows Quiet and a second session takes a
  Line; a write whose answer is lost is uncertain and shows the wall held and
  degraded, its `device/2.1` record's `held` naming that write (#975), until the
  next mode command;
- agent hooks through the 2.0 hook script (#926), with an unchanged 1.x producer
  file: a session, an approval prompt raised and cleared, a finished turn, the
  producer's credential refused a command and a read, a hook while the runtime is
  stopped exiting quietly within its budget, its observation lost, and the next
  hook reaching the restarted runtime;
- the [Codex Desktop module](../../modules/codex-desktop/README.md) (#926) with a
  simulated marker: a top-level Desktop session reads unread while Desktop lists
  it and read once it does not, a subagent gets no read evidence, an unusable
  marker gives none, and a Codex home that stalls makes the marker unavailable,
  logged once, while the core takes observations, until it answers again;
- the dashboard (#922): a browser signed in by a trusted loopback page loads its
  page and reads the core's sessions, which appear as the hook observes them,
  with an approval prompt raised and cleared (`dashboard-sessions`), and a
  finished turn that the dashboard shows unread under its own policy,
  until a new turn, positive read evidence or any consumer acknowledgment in
  the record clears it, never on a
  timer and never as an inbox item, and that leaves with its session
  (`dashboard-finished-turn`);
- the core's `operation` records (#922): a lamp switch the lamp holds stays
  `sent`, completes with the lamp's observation once released, a failed one
  says nothing reached the lamp, and the reader's copy holds each latest record
  (`operation-records`).

The gateway's scenarios scan every log record, message, health entry and
answer for the parts' synthetic token prefix, `tok_SYNTHETIC835`.

A seed's `config` gives configured modules their sections. Each harness writes
them into a private synthetic configuration file with a token
file per module that holds the synthetic token, and the edge's section with the
parts' credentials, and starts the runtime with it.
Both configured scenarios check that the token appears in no log record,
message, health entry or reader copy.

The deadline answers of an action, on both transports, since the core's
dispatcher sends every device command with the device kind's 5 s reply deadline:

| Case | Answer |
| --- | --- |
| A command its handler holds at the deadline | `uncertain-result`, and the tracker records it `uncertain` until its late outcome completes it |
| A command still queued at the deadline | `expired`, and the tracker records it failed |
| An action whose HTTP call is in flight when the runtime crashes | `lost`, the harness's label for a call that lost its connection; the tracker knows its fate |

Rows 1 and 2 follow the SDK's "Request and respond with expiry" requirement,
which the [remote transport](../../packages/sdk/README.md#remote-transport)
keeps. A requester that closes while its command is queued is the SDK's case:
its "One conformance suite for every transport" requirement fixes it per
transport, `cancelled` in process and `uncertain-result` remotely. The catalog
no longer plays it, since a part's action goes through the dispatcher, which a
caller that goes away does not cancel.

The scenarios assert the runtime's records on both transports: each deadline
answer's admission and ending at its level, the refusal of a command with no
responder, and each outcome's publication recorded once across the crash, the
lost acknowledgment and the restarts. The in-memory harness also records the
bus's and the modules' spans, and its tests check that the end-to-end path has
no lost parent and that work published after a restart links to its stored
context.

The harness never listens on an installed service's port (8765, 8787, 8788,
8791 or 41231). It keeps its state in a private directory under the system
temporary directory, which must be outside every Git checkout, and removes it
afterwards. Its tokens appear in no log record or message. It checks every
message it sees against profile 2.0.

## Checks

See [Runtime checks](../../docs/development.md#runtime-checks).

### Cutover preparation

Use [Set up a fresh runtime](SETUP.md) for the selected procedure: empty state,
manual configuration, a single-writer switch and a manual return to the old
installation. No transfer, migration or new installer adapter is required.

The internal model in `src/install/planner.ts` remains an unused pure planner
for the earlier migration proposal. It reads no installed state and performs
no operation. Its preparation digest grants no execution authority. Its
converter, receipt and capacity requirements do not apply to fresh setup.

After the root build, run the pure tests directly:

```sh
node --test apps/runtime/dist/tests/cutover-plan.test.js
```

Use the repository's Node and temporary-directory setup. The test creates no
runtime, listener or service and uses only synthetic facts. It is also included
in the core CI job's existing `test:runtime:built` file discovery. The complete
runtime suite includes process tests and requires its own isolated execution.

## Shared inbox and retained history

The core derives `inbox-item/2.1` from failed (expired included), uncertain and
conflicting operations in its tracker transaction. Late definitive evidence
updates an open item; handling alone deletes it. Conflict opens or reopens one
item above the prior removal revision. Other late outcomes after handling and
refused reused message identities open none. Finished turns remain session
notices. Gateway-only session-label-set and notice-clear metadata operations keep
tracker/history evidence and never enter this device-operation inbox. Items and handling actors survive restart; display `dismissedBy` and
device holds stay separate.

`GET /api/v2/history` reads committed `core_history`, oldest first, with optional
inclusive `fromAtMs`, `toAtMs`, `kind`, `source` and qualified `session` filters.
Filters combine; unknown, repeated or invalid fields are refused. Every caller
with read scope sees the whole history and inbox. The MCP tools `core_inbox`
and `core_history` read the same owner without triggering actions.

`POST /api/v2/commands/inbox-handle` takes `{target, requestId, data:
{expectedRevision, action}}`, where action is `dismiss` or `send-again`.
`core_handle_inbox` takes `{id, expectedRevision, action}`. Both need control;
the authenticated source supplies the handling actor. Dismiss commits the actor
and a `deleted` removal atomically. Send-again commits handling with a new
tracked sent operation using saved data and a fresh request ID, then sends once.
A failed initial commit leaves the original open. A crash after commit never
resends; the new tracked operation can become uncertain. Accepted handling is
separate from device completion: a later device refusal or uncertainty stays on
the new operation and does not reject committed handling. There is no automatic
retry, replay or expiry.

The catalog's `shared-inbox-history` journey and focused core/gateway tests use
synthetic state. One synthetic 1,000-item sync check records the largest encoded
state/completed message and total answer bytes against the existing per-message
256 KiB limit. Paging and timing targets remain outside this feature.
