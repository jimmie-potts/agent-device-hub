## ADDED Requirements

### Requirement: Action dispatcher and tracker

The core SHALL dispatch every device command, moment and mode change through one dispatcher, and track each as one operation (ADR 0012, "High-impact messages"; Hub #782). The gateway's action routes and MCP's `core_send_command` SHALL call it through the core module's `actions`, and core parts, such as automation, moments and the Hub mode, through `CoreHandle.dispatch`. An action SHALL be a command on `bunny.cmd.<family>.<target>` whose subject is the target, a type `org.bunny.<entity>.<verb>.requested`, a schema and an object payload, with who asks for it and an optional request ID, which one is generated without. The dispatcher SHALL refuse, before anything is recorded or sent, a malformed key, type, payload or request ID with `invalid-request`, a subject that is not its key's target with `invalid-message`, and the core's own operator commands, `approval-recover` and `notice-acknowledge` (`DIRECT_COMMANDS`), with `invalid-request`.

It SHALL record the action as `sent` in the core store before it sends anything, so a full disk refuses it with `unavailable` and the detail `storage-full` before any reply could say accepted, and nothing is sent. It SHALL send the command once, as `bunny/core`, with its kind's reply deadline as its expiry, inside a server span `bunny.command.request` that the command's request continues, record the owner's reply, and answer the caller with it: `accepted`, the owner's or the bus's refusal, or `uncertain-result`. The kinds and their deadlines, from the moment the action was recorded sent, SHALL be:

| Kind | Families | Reply deadline | Outcome deadline |
| --- | --- | --- | --- |
| device | every command to one device, a module's own families included | 5 s | 30 s |
| moment | `moment-play` | 5 s | 150 s |
| mode | `mode-set` | 5 s | 60 s |

The operation's state machine SHALL be: `sent`, then `accepted` on the owner's `accepted`, then `completed` with the outcome's result and evidence; `rejected` on a refusal, failed with evidence `none`, since a rejection proves no effect; `expired` when the command was still queued at its reply deadline, failed with evidence `none`; and `uncertain` when the handler had it at its reply deadline or no outcome arrived by the outcome deadline, with evidence `none` and `uncertain-result`. A late outcome SHALL complete the record: a definitive one, `succeeded` or `failed`, SHALL replace an uncertain result, history keeping both; an uncertain one SHALL add only its evidence to a definitive result; and a `succeeded` and a `failed` outcome for one operation, in either order, SHALL keep both, with the operation in `conflict` for a person, arrival order never picking a winner. A reply after an outcome SHALL only record what the owner said. A request ID SHALL name one action, ever: the same caller asking for the same action again SHALL get what that action got (`accepted`, its refusal, or `uncertain-result` while its reply is unknown) and nothing SHALL be sent; another action or another caller under that ID SHALL be refused with `duplicate-conflict`. Nothing SHALL ever send a command again: not a timed-out or uncertain one, not after a restart, which SHALL only let each pending operation's deadline pass, ending it `uncertain`. Each step SHALL commit with its history row and each part's rows for it in one transaction, and SHALL be logged once, in the action's trace: `command.queued`, `command.admitted`, `command.rejected` at its code's level and `command.completed` (INFO for success, WARN for a failed, uncertain or conflicting result, and `bunny.reason` `timeout` at a deadline). The tracker's rows with a failed, expired, uncertain or conflicting result SHALL be the rows #923 turns into inbox items.

#### Scenario: Sent, accepted, completed
- **WHEN** an operator's action reaches a module that accepts it and reports its outcome
- **THEN** the operation is `completed` with the outcome's result and evidence, its owner, its command and its payload kept; history holds the steps `sent`, `reply accepted` and `outcome completed` with the outcome itself; each change reached the parts; the module got the command once, from `bunny/core`; and the core logged `command.queued`, `command.admitted` and `command.completed` in one trace with the outcome

#### Scenario: A refusal, a stopped module and an expiry
- **WHEN** a module refuses an action, an action's family has no running module, and an action waits behind one the module's handler holds past the reply deadline
- **THEN** the first two are `rejected`, failed with evidence `none` and their codes, the queued one is `expired` and never reached the module, and the held one is `uncertain`; once released its outcome completes it, and history keeps the uncertain step and the outcome

#### Scenario: An outcome deadline
- **WHEN** an accepted action has no outcome by its kind's outcome deadline, on the runtime's clock, and its outcome arrives later
- **THEN** a millisecond earlier it is still `accepted`, at the deadline it is `uncertain` with a WARN record, and the late `failed` outcome completes it while history keeps both; nothing was sent again

#### Scenario: A restart while an action is pending
- **WHEN** the runtime stops while an accepted action waits for its outcome and starts again on the same state directory
- **THEN** the action is still pending, ends `uncertain` at its deadline, is never sent again, and the same request ID answers what it got without sending

#### Scenario: Late and conflicting outcomes
- **WHEN** an action's module reports `succeeded` and later `failed` for it, another reports `failed` and later `succeeded`, and each sends its last outcome again unchanged
- **THEN** each operation is in `conflict` with both outcomes kept, the parts hear of the conflict, and each retransmission is acknowledged again and changes nothing

#### Scenario: One request ID, one action
- **WHEN** the same caller sends the same action twice under one request ID, then another payload under it, another caller uses it, and a refused action is sent again
- **THEN** the second answers `accepted` and sends nothing, the next two are `duplicate-conflict`, the refused one answers its refusal again, and each was sent once

#### Scenario: What is no tracked action
- **WHEN** the dispatcher gets a state key, a subject that is not its key's target, an approval recovery, a malformed request ID, a moment and a mode change nobody answers
- **THEN** the first four are refused before anything is recorded, and the moment and the mode change are tracked as kinds `moment` and `mode` with their deadlines, failed `unavailable`

#### Scenario: A full disk
- **WHEN** the core store is full and an operator sends an action
- **THEN** it is refused with `unavailable` and the detail `storage-full`, nothing is recorded, and the module never gets the command

### Requirement: Outcome intake and acknowledgment

The core SHALL take every state, removal, occurrence and outcome another participant publishes, on one subscription to every published key, so history keeps each participant's messages in order; it SHALL leave a hook's lifecycle observation to its reducer and keep no acknowledgment. The intake SHALL commit in bounded groups, at most 100 messages or about 50 ms of its own work each, with a turn of the event loop between groups, so a burst never holds the runtime for one commit per message; within a group each message SHALL keep its own verdict, as below, and a full disk SHALL refuse the whole group. Only a full intake queue SHALL lose a message: the bus drops what the subscription's bounded queue cannot hold, and the core SHALL record each such gap as `operation.failed` with `capacity` and the dropped count. A dropped outcome is not lost, since it stays unacknowledged in its module's outbox and comes again at the module's next start; a dropped occurrence or removal is, and a dropped state's change shows in its entity's next state. It SHALL drop a duplicate removal, occurrence or outcome by `(source, id)` durably, since history keeps each whole message once, across restarts. It SHALL refuse the same `(source, id)` with other content as `duplicate-conflict`, record it at WARN, keep the message apart for diagnosis, the latest 1,000, and change no operation, open no inbox item and send no acknowledgment. An outcome SHALL advance the operation whose request ID it names, when its subject is the operation's target, its type the command's outcome type and, once the owner replied, its source the owner; any other outcome SHALL be kept in history only.

Once a new outcome commits with its history rows and its operation's change, the core SHALL acknowledge it to its module with `outcome-recorded` (`bunny-message-profile`, "Outcome acknowledgment"), added in that transaction so it goes out after the commit. It SHALL acknowledge an exact duplicate again, with no durable work and no second change, so a lost acknowledgment recovers at the module's next start. A commit the store refuses SHALL send no acknowledgment, so the module keeps the outcome and sends it again. Every intake record SHALL be `message.received`, carrying the incoming message's trace and span: INFO for an outcome, occurrence or removal taken and for a duplicate outcome, which recovers an acknowledgment, DEBUG for any other duplicate, WARN for a conflict, and, for one the store refused, its code at that code's level, so a full disk's `unavailable` is WARN. Each module shipped with the runtime SHALL forget an acknowledged outcome through its outbox (`bunny-sdk`, "Per-module outbox").

#### Scenario: A module's crash between saving and reporting
- **WHEN** a module saves an outcome and the runtime stops before it goes out, and the runtime starts again
- **THEN** the module reports it at its start, history takes it once, the operation completes, the module is acknowledged, and no command is sent again

#### Scenario: A resent outcome
- **WHEN** the core's acknowledgment of an outcome is lost and the module restarts
- **THEN** the module sends the outcome again, the core records it as a duplicate at INFO, acknowledges it again and keeps one history row, and the next start sends it no more

#### Scenario: A reused (source, id)
- **WHEN** a module sends an outcome again with its message ID and other content
- **THEN** it is refused with `duplicate-conflict` at WARN in the message's trace, kept for diagnosis, the stored outcome stands, no part hears a change and no acknowledgment is sent

#### Scenario: A full disk
- **WHEN** an outcome arrives while the core store is full, and is sent again once there is room
- **THEN** the first is refused at WARN with `unavailable` and not acknowledged, its operation stays pending, and the second completes it and is acknowledged

#### Scenario: A burst
- **WHEN** a module publishes 600 occurrences in one turn
- **THEN** history takes all 600 in a few grouped commits, a timer set after the burst runs between two of them, and a service process at the default lag limit stays up

#### Scenario: Verdicts within a group
- **WHEN** one group holds a copy of a message history holds, the same `(source, id)` with other content, a new occurrence with its copy and a conflicting one, a duplicate outcome and a new outcome with its copy
- **THEN** each copy is a duplicate, each conflict is refused and kept, the duplicate outcome is acknowledged again, the new outcome completes its action and is acknowledged once, and the group commits once

#### Scenario: An intake queue overflow
- **WHEN** a module publishes more messages in one turn than the intake's queue holds
- **THEN** the core records one `operation.failed` with `capacity` and the dropped count, and history takes every message that was not dropped

#### Scenario: Trace context on the intake record
- **WHEN** the core takes an outcome, and a disposable run's follow query asks for that outcome's trace
- **THEN** the core's `message.received` carries the outcome's trace and span, and the trace query finds it with the outcome's publication

### Requirement: Core history

The core SHALL keep history in private rows of the core store, with no time limit, each written in the transaction that commits what it records: every removal, occurrence and outcome whole, the core's own and every other participant's; each state change, the core's own and every module's, as a compact change event, what changed since the record history held for that entity (`previous`, its revision, or null for a new entity, whose every member changed), each changed top-level member with its new value and each removed member, never a whole snapshot, a state that changed nothing or is stale adding nothing; and each step of every tracked action, as its event, status, result, evidence, error and the outcome that caused it. A removal SHALL leave a tombstone at its revision, so a late state at or below it adds nothing. History SHALL keep no hook's raw lifecycle observation, whose changes it keeps, and no acknowledgment. Viewing history SHALL never trigger a device or automation; its read API with filters and the timeline are Hub #923's (owner decision, 2026-10-07).

#### Scenario: What changed
- **WHEN** a module publishes a record, a change of one member, the same record again, an older one, a record without a member, an occurrence twice with one ID, a removal and a later state at the removal's revision
- **THEN** history holds three change events, the first with `previous` null and every member, the second with the one member, the third with the member removed, then the occurrence once and whole, and the removal, and nothing else

#### Scenario: The core's own changes
- **WHEN** a hook observes a session start and an approval prompt
- **THEN** history holds the two session states as change events, the second holding only what changed, and `attention.raised` whole, in the commits that published them

### Requirement: Action routes

With an edge, the gateway SHALL serve `POST /api/v2/commands/<family>` to a caller with `control`: `{target, data, requestId?}`, the device's routing ID, the command's payload without a request ID and an optional request ID, sent through the core's dispatcher as `bunny.cmd.<family>.<target>` for the caller's source, with the type `org.bunny.<entity>.<verb>.requested` and the schema `<family>/2.0` that follow from the family. The route SHALL check the command against its family's schema, as the edge checks a remote message, before the dispatcher has it: a body or target that is malformed, a payload that names a request ID or fails the schema, a family that is no command family, and the core's own operator commands SHALL be `invalid-request`, a family no module in the runtime answers `not-found`, and nothing SHALL be tracked or sent. It SHALL answer `{"schema": "command-reply/2.0", "status": "accepted", requestId}`, or the dispatcher's refusal or `uncertain-result` in the shared error body at its status, and `unavailable` when the runtime hosts no core or the core is not running. MCP SHALL offer `core_send_command`, `{family, target, data, requestId?}`, to a credential with `control`, which sends the same action. At the SDK edge, a remote grant SHALL request only the core's operator commands directly (`DIRECT_COMMANDS`): a device's command, a moment, a mode change and a module's own family, module-internal ones included, SHALL be `forbidden`, so no action bypasses tracking.

#### Scenario: An operator's action
- **WHEN** an operator sends a lamp switch on the action route, sends it again under its request ID, sends another under that ID, and sends one without a request ID
- **THEN** the first answers `accepted` with its request ID and is tracked to its outcome as the operator's; the second answers the same and sends nothing; the third is `duplicate-conflict`; the fourth gets a generated request ID; and the lamp switched once for the first

#### Scenario: Registry codes for invalid input
- **WHEN** the route gets a body that is not JSON, an extra member, a target that is not a routing ID, a payload with a request ID or outside its schema, a malformed request ID, a family no module answers, a family that is no command, a state family, the core's notice acknowledgment, a reader's and a hook's action, a query and no token
- **THEN** they answer 400 `invalid-request` for the malformed ones, 404 `not-found` for the unknown family, 403 `forbidden` for the reader and the hook, and 401 `unauthenticated` without a token, nothing reaches the lamp, and the refusals are logged by route template, never what the caller sent

#### Scenario: Direct requests at the edge
- **WHEN** an operator's remote part requests a lamp switch, a mode change and a notice acknowledgment directly through the SDK edge
- **THEN** the first two are `forbidden`, and the third reaches the core, which answers it

#### Scenario: MCP's action
- **WHEN** an operator calls `core_send_command` with a valid and an invalid payload, and a reader calls it
- **THEN** the first answers `accepted` and is tracked as the operator's, the second answers `invalid-request` in the shared error body, and the reader's never reaches the core

#### Scenario: Without the core
- **WHEN** the runtime hosts no core and an operator sends an action
- **THEN** it answers 503 `unavailable` and nothing is sent

## MODIFIED Requirements

### Requirement: Fixture module

The runtime's tests SHALL hold a fixture module, a simulated lamp that later stories use as their stand-in device module, a consume-only fixture chime, a configured fixture sign, and the fixture core: the real core with stand-in parts. A module that reaches a device SHALL be created by a factory that takes the device's transport, `create<Name>Module({transport})`, with no manifest slot or registry for transports; the lamp (`createLampModule`) and the chime (`createChimeModule`) SHALL show the convention with simulated transports that keep their state when the runtime restarts.

The lamp SHALL serve its lamps through sync, copy the core's mode and sessions, switch a lamp on its command family `lamp-switch`, on `bunny.cmd.lamp-switch.<lamp>`, named as ADR 0012 names commands so the core's action route reaches it, refuse an unknown lamp with `not-found` and switching on in quiet mode with `invalid-state`, and report each switch through its outbox: the lamp's state, an occurrence and the outcome, which its outbox forgets once the core acknowledges it. It SHALL accept a command whose `requestId` it already handled from the same source without acting or reporting again. When its lamp cannot be reached, its outcome SHALL be `failed`, with evidence `none` and the `unavailable` error. Its indicator SHALL show whether a session waits for a person. The chime SHALL ring once for each approval prompt in the sessions it copies, keeping what it rang in its own SQLite file across restarts. Both SHALL pass the module test kit.

The sign (`createSignModule({transport})` with `SimulatedSigns`, Hub #919) SHALL stand in for a device module with settings, a secret and private files. Its `configure` SHALL take a greeting, its signs' IDs and addresses, and its token's file as `secrets.token`, and SHALL name the signs as its devices. Its start SHALL read its token, keep its layout in its private folder and serve its signs' availability through sync, and SHALL return without reaching a sign. It SHALL then reach each sign on the runtime's scheduler with a deadline, to show the greeting it rendered with a worker call and the token: a sign that does not answer SHALL be `unavailable` and tried again with capped backoff, never a module failure, and one that shows the greeting SHALL be `available`. A render that fails, past its deadline included, SHALL be reported against the sign, once per run of failures with its registry code, and tried again, leaving the sign's availability as it was, never a module failure. It SHALL log each change of availability once, not each attempt. It SHALL pass the module test kit, policy A's check included.

The fixture core SHALL be the real core, with its tracker, history and outcome acknowledgment (Hub #782), and stand-in parts that join it through its extension point. They SHALL serve the mode, until Hub #924, and derive their rows from each tracked action's change, in the tracker's own transaction: until Hub #923's history read API, a readable copy of what history recorded of each action, a `stand-in-history` entry for each outcome the tracker took, by its source, and for each result an action reached without one, by the core; and until Hub #923's inbox, one `inbox-item` operation for each failed or uncertain action, which a later result never removes. The core SHALL serve the inbox and history families through sync with its sessions.

#### Scenario: The lamp passes the kit
- **WHEN** the runtime's tests run the module test kit on the lamp and on the chime
- **THEN** every check passes

#### Scenario: Under the runtime
- **WHEN** the runtime hosts the fixture core, the lamp and a requester, and the requester switches a lamp on
- **THEN** the request is accepted and the core takes the outcome once; in quiet mode the request is refused with `invalid-state`

#### Scenario: A kill between commit and publish
- **WHEN** the runtime process is killed after the lamp commits a switch and before it publishes anything, then started twice on the same state directory without the requester
- **THEN** at the first restart the lamp sends its state, occurrence and outcome, the core takes the outcome exactly once and acknowledges it, and the lamp forgets it; the second restart sends nothing; and the lamp never receives the command again

#### Scenario: A duplicate command
- **WHEN** a requester sends a lamp command again with the `requestId` the lamp already handled
- **THEN** the lamp accepts it, the device switches once and the core's history holds one outcome for it; through the core's dispatcher, the core answers the same action itself and never sends it again

#### Scenario: A lamp that cannot be reached
- **WHEN** the lamp's device fails a switch
- **THEN** the command is accepted, the outcome is `failed` with evidence `none`, and the core holds it in history and as a failed inbox operation

#### Scenario: A chime restart
- **WHEN** the runtime restarts while an approval prompt the chime rang for still waits
- **THEN** the chime does not ring for it again

#### Scenario: The sign passes the kit
- **WHEN** the runtime's tests run the module test kit on the sign with its section, its synthetic token and an instance whose sign never answers
- **THEN** every check passes, the offline check included

#### Scenario: A render that fails
- **WHEN** every render the sign asks for ends without a reply
- **THEN** the sign module keeps running, logs one `operation.failed` for the sign with `bunny.code` `uncertain-result`, publishes no availability and never reaches the sign

#### Scenario: A sign that is offline at start
- **WHEN** the runtime starts the sign from a private configuration file while its sign never answers, and the sign later comes online
- **THEN** the sign module is `running` and health `ok` once the starts settle, it reports the sign `unavailable` and stays running, then `available`, the sign shows `HELLO` with no refused token, its layout is in `modules/sign/layout.json`, and no record, message or health holds the token

### Requirement: Scenario catalog and in-memory harness

The runtime's tests SHALL keep one scenario catalog of seeds and named steps: actions, expectations within a time bound and observations that hold for a while. A seed SHALL name the modules to start, built by their factories with simulated transports, the families a reader copies, when it configures modules, each one's section, and the modules the runtime should refuse. A harness SHALL refuse to start a scenario in which any other module is unhealthy. Each execution adapter SHALL write a seed's sections, as an installer would, into a private configuration file with a private token file per module holding a synthetic token, and the edge's section with a credentials file that grants each part the catalog's `GRANTS` under a run-generated token's digest, and SHALL start the runtime with it. The harness contract SHALL include a `gateway` call that reaches the runtime's gateway over HTTP, on both transports, as a part with its token, as a browser that a trusted loopback page signed in, as a stranger with a made-up token, or with neither, and a `dispatch` call that sends a device's command as a part through the core's dispatcher on the gateway's action route (Hub #782), which labels a call whose connection the runtime's crash ended `lost`. Every execution adapter SHALL run the same definitions unchanged; a scenario SHALL touch the runtime only through the harness contract, and a transport-specific expectation SHALL be data in the scenario. A failed step SHALL name what it observed and stop the scenario.

The in-memory harness (tier 1) SHALL host a seed's modules in the runtime's module host, on a manual clock and scheduler that also drive the bus, the edge and every remote client. It SHALL mount the runtime's gateway on 127.0.0.1 for each runtime it starts, and SHALL run each scenario twice: with the scenario's parts on the host's bus, and with them reaching it through the gateway's SDK edge with a run-generated credential per part, whose grant the edge enforces. It SHALL be able to crash the runtime between the lamp's commit and its publish and start it again on the same state directory and edge port, to disconnect a part, and to lose the core's next acknowledgment to the lamp on its way. It SHALL never listen on an installed service's port (8765, 8787, 8788, 8791 or 41231), SHALL keep its state in a private directory outside every Git checkout, which it removes afterwards, SHALL keep its tokens out of every log record and message, and SHALL check every message it sees against profile 2.0. `npm run test:runtime:scenarios` SHALL run the catalog, and the core CI job SHALL run its `:built` variant after its fresh build.

The catalog SHALL cover an approval prompt reaching every module, a command with a tracked outcome, a module failing while the others continue, a part reconnecting and syncing, the runtime starting with zero modules, the agent-session core with no device module, a configured module starting while its device is offline and reaching it once it is online, a module whose configuration is invalid refused while the others run, the playback module following the speaker the phone plays to and turning a silent one stale, the Tidbyt module showing agent status and what plays on a simulated cloud with each tile behind its 15-second gate, the gateway's reads and refusals, a token outside its grant refused and a command sent again refused as a duplicate, an operator's approval recovery after a restart, a module's page, content, settings and MCP tool, Pixoo's Monitor following the core's sessions, a media command to the Pixoo accepted then completed once the media reached it, a Now Playing card for the playback module's presented speaker over Monitor and in a whole takeover of Media while the song plays on unchanged, the Pixoo starting while its device is offline and recovering once it answers, the Nanoleaf wall following an agent session and taking Work, Quiet and Free with its power and availability in its device record (Hub #844), and the early end-to-end path: a hook observation, the committed session, the simulated device's update, a tracked action, its outcome, history and inbox rows, then sync and read, with the same action sent again, a failed command whose inbox row the reader reads, the deadline answers, a disconnect, a crash-restart and a lost acknowledgment. Every device command in the catalog SHALL go through the core's dispatcher. The deadline answers SHALL follow the SDK on both transports, with the device kind's 5 s reply deadline: a command its handler holds at the deadline is `uncertain-result` and its operation `uncertain` until its late outcome completes it, and one still queued is `expired` and its operation failed, as `bunny-sdk` "Request and respond with expiry" requires. An action whose HTTP call is in flight when the runtime crashes SHALL be labelled `lost` by the harness, which is not an SDK answer: its fate is the tracker's to know. A requester that closes while its command is queued is the SDK's own case, which "One conformance suite for every transport" fixes per transport, since a caller that goes away does not cancel its action.

#### Scenario: Tier 1 in CI
- **WHEN** `npm run test:runtime:scenarios` runs
- **THEN** every catalog scenario passes in process and through the edge, every part reached the runtime through the edge in the remote run, and no message broke profile 2.0

#### Scenario: A duplicate, a disconnect and a crash on both transports
- **WHEN** the end-to-end scenario sends an action twice with one `requestId`, sends one the lamp cannot carry out, holds one past its deadline with another queued behind it, disconnects the reader while the lamp switches, crashes the runtime between the lamp's commit and its publish, and loses the core's acknowledgment of a later outcome
- **THEN** history holds one outcome for the duplicate, the core answered it itself and the device switched once; the held action is `uncertain` and the queued one `expired`, both in the inbox, and the late outcome completes the held one while history keeps both; the failed command's inbox row reaches the reader and survives the restart; the reader syncs again and hears nothing published while it was away; at the restart the lamp republishes its state, occurrence and outcome once, history takes the outcome once and the lamp receives no command; an outcome whose acknowledgment was lost goes out again at the next clean restart, the core takes it as a duplicate, acknowledges it again and keeps one history entry, and the restart after that republishes nothing

#### Scenario: A failed step
- **WHEN** an expectation never holds, an action throws or a held observation breaks
- **THEN** the scenario fails at that step with what it observed, and runs no later step

#### Scenario: Boundaries
- **WHEN** a harness starts
- **THEN** its edge listens on 127.0.0.1 on a port outside the installed services' ports, its state directory is mode 700 and removed afterwards, a state directory inside a Git checkout is refused with `state-dir-checkout`, and its tokens are unique and appear in no log record, edge record or message

#### Scenario: The agent-session core alone
- **WHEN** the core runs with no device module, a hook observes two sessions, an approval prompt raised and resolved, a turn's end and one session's runtime end, the panel acknowledges the finished turn's notice and the operator tries to acknowledge it as the panel, and the runtime restarts
- **THEN** on both transports the reader holds both sessions, hears `attention.raised`, `attention.cleared` with cause `resolved`, `turn.ended` naming the notice and `session.ended`; the finished turn stays on the session record as an unread notice and never becomes an inbox item; the notice is acknowledged by the panel only and the operator's attempt is `forbidden`; and after the restart the session is uncertain until a new turn's evidence makes it current

#### Scenario: An unexpected refusal
- **WHEN** the in-memory harness starts the misconfigured-module seed without its expected refusal, and then with it
- **THEN** the first start fails because the runtime did not start, and the second starts

#### Scenario: Configured modules on both transports
- **WHEN** the configured-module and misconfigured-module scenarios run in process and through the edge
- **THEN** the sign runs while its sign is offline, reports it `unavailable`, then `available` with the greeting shown and no token refused; with an invalid section the sign is `refused` with `invalid-request`, never reaches its sign, and the core still commits a session the reader holds; and in both, no log record, published message, health entry or reader copy holds the synthetic token

#### Scenario: Playback on both transports
- **WHEN** the speaker-playback scenario runs in process and through the edge: the phone plays to the HT-A9, the operator pauses, the phone switches AirPlay to the Move, the operator pauses again, the Move stops answering and answers again, and the Move never answers a later command, which the operator sends twice
- **THEN** the reader's copy of the playback record follows the presented speaker; each pause reaches the presented speaker only and history holds it succeeded with evidence `transmitted`; the silent Move's record turns `stale` with its song kept, a command meanwhile is refused `unavailable` and reaches no speaker, and the module logs one degradation and one recovery; the unanswered command is `uncertain` in history and the inbox, sent again under its request ID it is answered by the core, and the Move hears it once; and no message, reader copy or log record names a speaker's address or carries the synthetic token; every command goes through the core's dispatcher, so the operator's direct request at the SDK edge is `forbidden`; and the reader, whose grant may only read, is refused a playback command with `forbidden`

#### Scenario: The Tidbyt's tiles
- **WHEN** the tidbyt-tiles scenario runs in process and through the edge: the runtime starts with no session and nothing playing over AirPlay, the hook observes a session start and a turn, then an approval prompt, its answer and a second prompt inside the gate, and the phone plays a song to the Move; once the song's card has stood past its gate, the runtime restarts cleanly with the Move answering each call 400 ms late, after the HT-A9; then the phone pauses the song and stops it
- **THEN** the idle start writes nothing to the simulated cloud; the status tile shows the frame the reader's sessions call for, and the burst makes one later push of the latest state, at least 15 seconds after the first; the now-playing tile shows the song's card, which the restart neither removes nor pushes again while the playback record waits for the Move's first read, then the pause marker, behind its own gate, and leaves the rotation when the music stops; after the restart the status tile is pushed again with its session dimmed as uncertain; the reader holds the Tidbyt's device record from `bunny/modules/tidbyt` with no control; and neither the API key nor the cloud device appears in a log record, message, health entry or reader copy

#### Scenario: The gateway on both transports
- **WHEN** the gateway-reads, grants-and-duplicates, approval-recovery and module-contributions scenarios run in process and through the edge
- **THEN** a part reads sessions on `/api/v2`, through the snapshot read API and through the `core_sessions` MCP tool; a malformed family is `invalid-request`, an unknown one `not-found`, a made-up or missing token `unauthenticated`, a credential or browser session used from another site and a hook reading `forbidden`, and a route of the old Hub `not-found`, logged with its route; a hook's, a reader's and the operator's direct lamp command are `forbidden` and switch nothing, a recovery whose subject names another session than its key is `invalid-message`, and a hook's moment occurrence on a lifecycle key is `forbidden` and heard by nobody; a raw notice acknowledgment sent again is `duplicate-conflict` and the core runs it once; the hook's recovery is `forbidden`, a stale revision `revision-conflict`, and the operator's recovery clears the approval with cause `recovered`; the sign's page, preview, settings and tool are served, the page without a session is `unauthenticated`, and the hook, which may not read, is refused the settings with `forbidden`; and no log record, message, health entry or answer holds a part's token

#### Scenario: The Pixoo on both transports
- **WHEN** the four Pixoo scenarios run in process and through the edge, with a simulated Pixoo and the playback module's simulated speakers
- **THEN** the Pixoo shows the waiting session's two-frame dashboard and then a calm one; an import, a playlist and a start complete, the start accepted at once and completed `transmitted` once the Pixoo shows the media; the presented speaker's song pops up as a card over Monitor for ten seconds without dimming, and while it plays on unchanged a whole takeover in Media keeps its current card for more than 30 s, until the song stops; and after a restart while the device is offline the module runs with the device `unavailable`, logs one degradation and one recovery, and the device is `available` once it answers

#### Scenario: The Nanoleaf wall on both transports
- **WHEN** the nanoleaf-wall scenario runs the core and the Nanoleaf module with a simulated Lines controller, in process and through the edge, and the reader follows `device`, `nanoleaf-wall` and `nanoleaf-animations` from `bunny/modules/nanoleaf` by name
- **THEN** health lists those three families in the Nanoleaf module's `serves`; the reader's sync of `device` alone from the module holds the wall's record only, and the module runs on; the reader's copy shows the wall available with the power it reported, the working session on a Line and then its finished turn unread; Quiet, Free and Work are accepted with outcomes history records as observed, since a mode is the module's own state, the Lines dim to the Quiet level and play their saved scene in Free; a moment and an animation in Work are refused with `unsupported-capability`; the wall switched off in its app shows observed power off; an unanswering wall shows unavailable while the module runs, then available, with one `device.unavailable` and one `device.available` record; Quiet sent meanwhile succeeds as observed and holds nothing, so once the wall answers it shows Quiet and a second session takes a Line; a brightness write whose answer is lost is uncertain in history and shows the wall held and `degraded` until the next mode command, with the hold logged once; and no record, message, health entry or reader copy holds the synthetic token

### Requirement: Simulated modules and the SDK edge

The shipped module list SHALL be a list of module factories, each of which creates its module with its real device transport or with its simulated one, and, for a module that takes a configuration, gives a section that configures its simulated build with the names of the secrets it needs (Hub #844, #929); with `--simulate`, the runtime SHALL build every module with its simulated transport. With `--edge`, the runtime SHALL serve its gateway (see "Runtime gateway callers") on its health listener, and through it the SDK's remote transport (`RemoteEdge`, #883) under `/api/sdk/v1/`, on the modules' bus. The gateway SHALL serve only once every module's start has settled, and only until the runtime stops: before then, and from the start of a stop until the listener closes, its routes SHALL answer 503 with `unavailable`. Its callers SHALL come from the configuration file's `edge` section and the credentials file it names (see "Edge credentials and their reload"); `--edge` without that section SHALL refuse to start with `edge-config-missing`, before it serves. A credential whose source is the core's (`bunny/core`), a module's (`bunny/modules/<name>`) or the runtime's own (`bunny/runtime/...`) SHALL be refused with `edge-credential-source`, so no remote part can publish as either. No refusal or log record SHALL quote a token. The edge SHALL check remote messages against profile 2.0, the core families, the device families that every device module answers (Hub #918, #928), the modules' own schemas and any families the caller adds, and the runtime SHALL log the edge's connections, disconnections and refusals. As the diagnostic contract requires, a record SHALL NOT hold the raw message or stack: a refusal's record SHALL hold its route, or `other` when the route is none of the edge's, its caller's source if admitted, its code from the 2.0 error registry and, in the diagnostic contract's `bunny.reason`, that code's fixed registered reason (none for `internal` or `uncertain-result`, whose effect may have happened), and never the refusal's detail. The `runtime.started` record SHALL say whether modules are simulated and whether the edge is configured, and a `runtime.edge.serving` record SHALL follow once the gateway serves; both SHALL carry the listener's port, never its URL. Stopping the runtime SHALL close the gateway before it stops the modules.

#### Scenario: A remote part with a grant
- **WHEN** the runtime runs with an edge, the fixture core and a credential for `bunny/parts/reader`
- **THEN** a remote part with that credential's token connects and syncs the core's sessions, one with another token is `unauthenticated`, a call without a token answers 401, the edge's connection is logged with its source, and no token appears in a log record

#### Scenario: Before the modules have started
- **WHEN** a remote part keeps trying to connect with its credential while a module's start is still running
- **THEN** the edge answers 503 with `unavailable` until the start settles, and the same part's next attempt connects; a request with a browser `Origin` and the part's token answers 403

#### Scenario: While the runtime stops
- **WHEN** the runtime is stopping and a module's stop is still running
- **THEN** the edge's stream and calls answer 503 with `unavailable` until the listener closes

#### Scenario: An edge refusal in the log
- **WHEN** a remote part calls a route the edge does not have, sends a malformed call, or calls without a token
- **THEN** each refusal is logged with its route or `other`, its registry code and that code's registered reason, and nothing the caller sent appears in a log record

#### Scenario: A grants file the runtime refuses
- **WHEN** the runtime runs with `--edge` and no configuration file, a configuration without an edge section, or a credentials file that is missing, has mode 644, is a symbolic link or a second hard link, is not JSON, names another schema, holds a digest that is not one, a malformed source, an unknown scope, a credential that names devices, a token two credentials share or an ID used twice
- **THEN** the runtime refuses to start with `edge-config-missing`, `edge-credentials-missing`, `edge-credentials-not-private` or `edge-credentials-invalid`, and the refusal never quotes a token

#### Scenario: A grant that acts as the core or a module
- **WHEN** a credential names `bunny/core`, `bunny/modules/lamp`, `bunny/modules/core` or `bunny/runtime/gateway`, through `startRuntime` or the shipped entry point with `--edge`
- **THEN** the runtime refuses to start with `edge-credential-source`, which the entry point names in `runtime.failed` with exit status 1 and no ready line

#### Scenario: Device commands through the edge
- **WHEN** remote parts send `device-mode-set`, `power-set` and `lifx-color-set` commands to the LIFX module in the catalog's `lifx-bulbs` scenario, through the core's dispatcher on the gateway's action route, and request one directly at the edge
- **THEN** the gateway checks each as its device or module family, the module answers each, and every message the parts see follows profile 2.0; the direct request is `forbidden` for the operator and for a part whose grant may only read; and the reader and the panel both read their `device` records

#### Scenario: Simulated modules
- **WHEN** the shipped entry point runs with `--simulate`, `--edge` and a configuration whose credentials file grants a reader
- **THEN** a remote part with the reader's token reaches its edge, the `runtime.started` record says the modules are simulated and the edge is configured, one `runtime.edge.serving` record follows once every module has started, SIGTERM stops it with exit status 0, no record holds the token, and each module factory builds its simulated module under `--simulate` and its real one otherwise

### Requirement: Core store transactions and failures

The core store SHALL keep agent-state's durable 2.1 state in the old Hub adapter's format, one JSON row in the table `state`, checked on every load and commit under a compare-and-swap on the revision. It SHALL hold a lease, an exclusive transaction on the lock database `core.sqlite-owner` beside it, taken without writing anything, from the core's start until it stops, including while it opens agent-state's owner again after a failed commit; a second owner, in another process or this one, SHALL never get it while the first holds it: one in another runtime SHALL be refused when it opens the core's database, which the first keeps to itself, and one that reaches the lease SHALL wait for it until agent-state's deadline. Each lease SHALL reload the store's revision, commit count and records from the file, and a file that holds another owner's state SHALL be refused before anything is written to it. Each change SHALL commit with the 2.0 messages it publishes, the published records, the history rows of everything it publishes, each state as a compact change event and every removal and occurrence whole (see "Core history"), and the `(source, id)` of the intake it took, kept for 24 hours past the later of the commit and the observation's own instant, in one SQLite transaction through the SDK's outbox, and its messages SHALL go out only after the commit, in order. Each change SHALL take that one commit, and what it published one more after the sends, both at the connection's level; after a crash between the sends and that commit, the next start SHALL send the change's messages again with their stored `id`s. A change that does not commit, a failed rollback included, SHALL change nothing, publish nothing and never be reported committed. On a full disk the core SHALL refuse the change before anything reports it accepted, log the intake `rejected` with `capacity`, and open agent-state's owner again on what committed, so the next observation is taken once there is room. A full disk SHALL never fail the core: an owner that cannot be opened again, a full disk at the start, whether a first start, where the store cannot create its tables, or a start after a clean stop, and a refresh the store refuses SHALL leave it running, refusing durable work with `capacity` or `unavailable` and syncs with `unavailable`, and trying again after a backoff that doubles from 1 s to 60 s. While the store refuses durable work, the core SHALL record the transition once, then a summary at most once a minute, then the recovery, with each attempt at DEBUG. A publication refused after a commit SHALL leave the change standing, be recorded once per run of refusals as `outbox.deferred`, and go out at the next commit or start with the message's stored `id`, `time` and trace context. After a crash between a commit and its publication, the next start SHALL send each stored message once.

#### Scenario: One transaction
- **WHEN** an observation commits a session and an attention item
- **THEN** the state row, the records, the core's revision, the history rows of the session's changes and of the occurrence, and the intake's `(source, id)` are stored, and the outbox lets the messages go once they are published

#### Scenario: The old Hub's format
- **WHEN** a store is written and opened again
- **THEN** its `state` table has the Hub adapter's columns, its payload passes agent-state's `validateExport`, and the reopened owner holds what was committed

#### Scenario: A full disk
- **WHEN** the store's file can grow no further and an observation would create a session
- **THEN** agent-state reports `storage-failed`, the store names the failure `full`, every row is unchanged, nothing is published, the runtime logs the intake `rejected` with `capacity` at WARN and no second `accepted`, and once there is room the same message is taken

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
- **WHEN** a second owner opens the store while the first holds it, and again once the first lets go
- **THEN** the first attempt is refused at agent-state's deadline, and the second reads what the first committed

#### Scenario: The lease through a failed commit
- **WHEN** a second core waits for the lease while the first has a commit refused on a full disk and opens its owner again, with a pause in which the second keeps trying
- **THEN** the second is refused, the refused change leaves the revision as it was and takes nothing, and the first's next change commits at a higher revision

#### Scenario: A lock that cannot keep a journal
- **WHEN** the lock database's rollback journal cannot be written
- **THEN** the lease is still taken

#### Scenario: A full disk that persists
- **WHEN** maintenance falls due while the disk is full, the core restarts with stored sessions on a full disk, or its start-up maintenance falls on one
- **THEN** the core keeps running and health shows it running; intake is refused with `capacity` and syncs with `unavailable`; within the backoff the core does not try again; and once there is room the next attempt succeeds and the condition ends with one record

#### Scenario: A real full disk at the start
- **WHEN** the runtime's state directory is on a full disk that refuses every write with ENOSPC, and the core starts on it for the first time, or again after a clean stop
- **THEN** the core opens its database and runs, health shows it running, an observation is refused with `capacity` and a sync with `unavailable`, and once there is room the next observation is taken and syncs are served

#### Scenario: Retries back off
- **WHEN** the store refuses the freshness change for two minutes
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

### Requirement: Core extension point

The core SHALL take parts, the extension point for #923's inbox and later core stories; its tracker and history (Hub #782) are its own. A part SHALL be able to create its own tables in the core store once the core holds it, serve its families through the core's sync at the core's revision, derive rows from each committed core change and from each tracked action's change (`tracked`, with the operation, its previous state and the outcome that caused it) in that change's transaction, run its own intake through the core store's transactions and outbox, and dispatch actions and read a tracked action through its `CoreHandle`. History SHALL keep what a part publishes, and a part's transaction MAY keep another participant's message and an action's step in history. A part that throws in a change's transaction SHALL roll the whole change back.

#### Scenario: A part's rows
- **WHEN** a part derives a row from each committed change, and then throws
- **THEN** the first change's row commits with it, and the throw leaves every row unchanged, publishes nothing and is reported as a failed commit

#### Scenario: A part's rows for a tracked action
- **WHEN** a part derives rows from the tracker's changes while an action is sent, accepted and completed
- **THEN** it hears each change in order, the last with its outcome, and its rows commit with each step

### Requirement: Runtime gateway callers

With an edge, the runtime's gateway SHALL serve every route of the listener but health, and every refusal SHALL be the shared error body with a code from the 2.0 registry at the HTTP status that fits it, with fixed text that quotes nothing the caller sent, and every JSON answer, health's included, SHALL carry `x-content-type-options: nosniff`. A caller SHALL be either a client credential, which presents its bearer token and SHALL carry no `Origin` and no `Sec-Fetch-Site` other than `none`, or a browser session, which the `bunny-session` cookie carries (`HttpOnly`, `SameSite=Strict`, eight hours, at most 16 sessions) and which acts as `bunny/parts/dashboard` with `read` and `control`. No caller SHALL be limited to some devices (owner decision, 2026-10-07). A browser session SHALL be presented only by this origin's own pages or the browser itself: an `Origin` or `Sec-Fetch-Site` of another site SHALL be refused with `forbidden`, and a change (any method but GET or HEAD) SHALL name this origin and carry `bunny-request: 1`. This origin SHALL be `http://` and the host the request names, `127.0.0.1:<port>` or `localhost:<port>`, so a page on the other loopback name is another origin. When a request carries several session cookies, the one that is a live session SHALL be taken. A credential presented from a page SHALL be refused with `forbidden`, a made-up or revoked token and a request with neither with `unauthenticated`.

A browser SHALL sign in only from this origin's own page, naming it and carrying `bunny-request: 1`: with a launch code at `POST /api/v2/browser/launch`, or, when the edge section sets `browserAccess` `trusted-loopback`, at `POST /api/v2/browser/session`, which otherwise answers `not-found`. The runtime SHALL serve the launcher's socket, `bunny-launch.sock` in its state directory, owner-only, unless the edge section sets `launcher` false; each connection SHALL get the runtime's origin and a code good once for 30 seconds, at most eight waiting. A socket path over 107 bytes SHALL refuse the start with `launcher-path-too-long`. `POST /api/v2/browser/logout` SHALL end the cookie's session and its streams and clear the cookie, and a session evicted by the seventeenth or ended at its expiry SHALL have its streams ended at once too. A session token SHALL travel only in `Set-Cookie`.

At the SDK edge, each caller's scopes SHALL become its grant's calls, routing keys and families: `read` SHALL subscribe and sync every state and event key, `ingest` SHALL publish the `lifecycle` family on `bunny.event.lifecycle.*` only, `control` SHALL request the core's operator commands only, `bunny.cmd.approval-recover.*` and `bunny.cmd.notice-acknowledge.*`, which the core's dispatcher names (Hub #782), and send every other command through the action routes (see "Action routes"), and `admin` SHALL add nothing. So a hook's credential with `ingest` SHALL be refused with `forbidden` for any command, read, subscription or other family's message.

#### Scenario: Registry codes for every refusal
- **WHEN** credentials send a malformed family name, a query a route does not take, a recovery that is not JSON or over the body limit, a made-up token, no token, a hook's read, a reader's recovery and a scope the caller lacks
- **THEN** they answer 400 `invalid-request`, 400, 400, 413 `too-large`, 401 `unauthenticated`, 401, 403 `forbidden`, 403 and 403, each the shared error body with only its code, flag and detail, and a hook's command through the SDK edge is `forbidden`, as is its moment occurrence on a lifecycle key, which nobody hears

#### Scenario: Origin checks
- **WHEN** a credential's request names this or another origin or carries fetch metadata from a page, sign-in comes without the request header or from another site, and a session cookie is used from another site, from the same site or for a change without the header
- **THEN** each is refused with `forbidden`, a proper sign-in sets an `HttpOnly`, `SameSite=Strict` cookie whose token appears in no body, the session reads from this origin and a bookmark, MCP refuses it, and logout ends it

#### Scenario: The launcher
- **WHEN** the launcher asks the runtime's socket for a code, the page exchanges it, and the same code or a made-up one is tried again, with trusted loopback sign-in off
- **THEN** the first exchange signs the browser in and its page loads, the others are `unauthenticated`, trusted loopback sign-in answers `not-found`, and no record holds the code

#### Scenario: A bookmark on localhost
- **WHEN** a page on `http://localhost:<port>` signs in, reads and recovers an approval through requests that name `localhost:<port>`, a page on `127.0.0.1` signs in through one that names `localhost`, and a request carries a stale session cookie before the live one
- **THEN** the sign-in, the read and the change are served, the other loopback name's sign-in is `forbidden`, and the live cookie is taken

#### Scenario: Sessions that end without a logout
- **WHEN** a browser session holds an SDK stream and sixteen more sessions open, and later the newest session, holding a stream, reaches its expiry
- **THEN** the evicted and the expired sessions' streams end at once, logged for `bunny/parts/dashboard`, and each cookie is `unauthenticated`

#### Scenario: Reads no module can answer
- **WHEN** a caller reads a family no module in the runtime serves, by family and by snapshot, and a snapshot of two owners' families, and later the family of a module whose page failed it
- **THEN** the first two are `not-found`, not retryable, saying no module serves it, and the third `invalid-request`, saying to name families that one module serves; and once the only module that serves a family fails, its family read and its snapshot are `unavailable`, retryable, saying the module is not running

#### Scenario: No reader limited to some devices
- **WHEN** a reader with `read` alone reads the family of a module that names two devices in its configuration, a snapshot of it at schema version 2.1, the links and the module list, opens the module's page, content and settings, and syncs the family through the SDK edge
- **THEN** it reads both devices' records and editor links, the module is listed with its page, tool and settings and each of them answers, and its copy and the answer's membership hold both devices

### Requirement: Gateway routes

The gateway SHALL serve, to a caller with `read`: `GET /api/v2/families/<family>`, every record of a core, device or module state family, combining, for a family that several modules serve such as `device`, each owner's records in one answer, each from a copy of that owner it syncs on the first read and keeps following, at most 32 copies, never by polling (a malformed name `invalid-request`, an unknown family `not-found`, a family no module in this runtime serves or served `not-found` with text that says so, one whose every owner is a module that has failed or stopped, or cannot be read, `unavailable`, and an only owner's refusal its code with fixed text for that code). An owner that is down or cannot be read SHALL never fail the others (policy A): the answer SHALL carry `unavailable`, the sources of those owners alone, empty when every owner answered, so a reader never takes their records for absent; `GET /api/v2/snapshot?families=<a>,<b>[&owner=<source>]`, one owner's families at its revision from one sync, with no copy kept, each record in the family its schema names at any version: the named owner's, `not-found` when it does not serve every named family and `unavailable` when it is down, or else the one owner of every named family, and families of more than one owner `invalid-request` with text that says to name one module's families or the owner; `GET /api/v2/modules`; `GET /api/v2/modules/<name>/settings`; `GET /api/v2/links`, the editor links and the place links; and each module's pages and content. The snapshot route SHALL be the gateway's one-off sync, the second implementation of ADR 0012's snapshot read API, for a caller of this one process. It SHALL answer `GET /api/v2/authority?scope=<scope>` for any caller, 200 when it holds the scope and `forbidden` otherwise. Every document SHALL carry `schema` `<family>/2.0`. A module SHALL count as a family's owner, serving or down, only once it has served that family; this is a known limit: a module that never served, refused at admission or failed in its start before it first served, is not counted, so a combined read such as `GET /api/v2/families/device` answers the other owners with `unavailable` empty, and a family only that module would serve reads `not-found`. A reader such as the dashboard therefore cross-checks each module's state in `GET /api/v2/modules`.

A module's pages, content, settings and tools SHALL be every reader's, and the module list SHALL show them once the module is admitted. A module's contribution SHALL be called only while the module runs (otherwise `unavailable`) and SHALL be answered within 5 s (otherwise `unavailable`). An exception that escapes it SHALL fail the module, as one from a handler does, and be answered `internal`. A page SHALL be served in a document whose policy allows no script, frame, form or base and only images and styles from the runtime itself; content SHALL be an image, plain text or JSON of at most 16 MiB; and a page, settings, content of any type, its bytes searched, or tool answer that holds a secret a module read, a tool's refusal included, SHALL never be served (`internal`).

`/mcp` SHALL serve MCP through `packages/mcp`, unchanged, only when the edge section sets `mcp` true, as the old Hub served it only with its `mcp` set, and SHALL otherwise answer `not-found`. It SHALL serve client credentials only, telling a browser session so with `forbidden` before anything else: each module's read tools, as `<module>_<tool>`, to a credential with `read`, and `core_recover_approval` and `core_send_command` (see "Action routes") to one with `control`. A tool's result SHALL be `{result}` and a refusal the shared error body, both under the package's `extension` data. The refusals `packages/mcp` makes itself before a tool runs SHALL keep its released 1.x `gateway-error` result, with the registry's code and no detail: an exception to the shared error body, since the package is reused unchanged. MCP protocol errors SHALL keep the MCP specification.

#### Scenario: MCP by scope
- **WHEN** an operator, a reader and a hook list MCP tools, the reader calls `core_recover_approval`, and the operator calls `sign_status` and `core_recover_approval` for an unknown session, an unknown tool, and with an `Origin`
- **THEN** the operator sees `core_recover_approval`, `core_send_command`, `core_sessions` and `sign_status`, the reader the two read tools, the hook none; the reader's recovery never reaches the core; `sign_status` answers its result, the recovery the core's `not-found` in the shared error body, the unknown tool an MCP protocol error, and the request with an `Origin` `forbidden`

#### Scenario: MCP off, and a browser session on it
- **WHEN** `/mcp` is called with the edge section's `mcp` unset, and with it set by a browser session without the request header
- **THEN** the first answers `not-found`, and the second `forbidden`, saying the route takes a client credential

#### Scenario: Contributions and their failures
- **WHEN** a module's page throws, a module's settings, text content, JSON content, image content and tools answer with a secret it read, one tool refusing with it in its detail and one answering `{"error": null}`, its content has a type the gateway does not serve, and its family's owner refuses a sync with the secret in its detail
- **THEN** the page answers `internal` and its module fails while the core runs, a later request to it is `unavailable`, the settings, contents and tool answers are `internal`, the odd content is `internal`, the family and snapshot reads answer the owner's code without its detail, and the secret appears in no answer or record

#### Scenario: Owners that cannot answer
- **WHEN** three device modules serve `device`, one refuses its syncs, then a second fails, and then the third fails too
- **THEN** the family reads the first two's records with `unavailable` naming the refusing module, then the first's with `unavailable` naming the refusing and the failed modules and the failed module's snapshot `unavailable`, and at last the read is `unavailable`, never serving an owner's detail

#### Scenario: A family that two modules serve
- **WHEN** the lamp and the sign both serve `device`, a reader reads the family, and snapshots of it name no owner, the lamp, the sign with `sign` beside it, an owner that serves no device, an owner that does not serve `session`, a malformed owner and two owners
- **THEN** the family reads as both devices with no owner `unavailable`; the unnamed snapshot is `invalid-request` saying to name the owner; the lamp's holds the lamp, the sign's the sign in both families; the others are `not-found`, `not-found`, `invalid-request` and `invalid-request`, quoting nothing they were given

#### Scenario: A page that loads its preview by reference
- **WHEN** a reader opens the sign's page and its preview, its settings and the links
- **THEN** the page refers to `content/preview.png` under a policy with `default-src 'none'`, `frame-ancestors 'none'` and `form-action 'none'`, the preview is a PNG, the settings show the greeting and signs without the token, and the links hold the sign's editor link and the place links

#### Scenario: A stalled reader
- **WHEN** a reader subscribes to large state messages and stops reading until its socket fills, and the stall limit passes
- **THEN** the gateway's edge ends the stream and logs `runtime.edge.disconnected` at WARN with `capacity` and its reason
