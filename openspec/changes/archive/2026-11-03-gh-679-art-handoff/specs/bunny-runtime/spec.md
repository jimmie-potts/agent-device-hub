## MODIFIED Requirements

### Requirement: Action dispatcher and tracker

The core SHALL dispatch every device command, moment and mode change through one dispatcher, and track each as one operation (ADR 0012, "High-impact messages"; Hub #782). The gateway's action routes and MCP's `core_send_command` SHALL call it through the core module's `actions`, and core parts, such as automation, moments and the Hub mode, through `CoreHandle.dispatch`. An action SHALL be a command on `bunny.cmd.<family>.<target>` whose subject is the target, a type `org.bunny.<entity>.<verb>.requested`, a schema and an object payload, with who asks for it and an optional request ID, which one is generated without. The dispatcher SHALL refuse, before anything is recorded or sent, a malformed key, type, payload or request ID with `invalid-request`, a subject that is not its key's target with `invalid-message`, and the core's own operator commands, `approval-recover` and `notice-acknowledge` (`DIRECT_COMMANDS`), with `invalid-request`.

It SHALL record the action as `sent` in the core store before it sends anything, so a full disk refuses it with `unavailable` and the detail `storage-full` before any reply could say accepted, and nothing is sent. It SHALL send the command once, as `bunny/core`, with its kind's reply deadline as its expiry, inside a server span `bunny.command.request` that the command's request continues, record the owner's reply, and answer the caller with it: `accepted`, the owner's or the bus's refusal, or `uncertain-result`. The kinds and their deadlines, from the moment the action was recorded sent, SHALL be:

| Kind | Families | Reply deadline | Outcome deadline |
| --- | --- | --- | --- |
| device | every command to one device, a module's own families included | 5 s | 30 s |
| moment | `moment-play` | 5 s | 150 s |
| mode | `mode-set` | 5 s | 60 s |

The operation's state machine SHALL be: `sent`, then `accepted` on the owner's `accepted`, then `completed` with the outcome's result and evidence; `rejected` on a refusal, failed with evidence `none`, since a rejection proves no effect; `expired` when the command was still queued at its reply deadline, failed with evidence `none`; and `uncertain` when the handler had it at its reply deadline or no outcome arrived by the outcome deadline, with evidence `none` and `uncertain-result`. A late outcome SHALL complete the record: a definitive one, `succeeded` or `failed`, SHALL replace an uncertain result, history keeping both; an uncertain one SHALL add only its evidence to a definitive result; and a `succeeded` and a `failed` outcome for one operation, in either order, SHALL keep both, with the operation in `conflict` for a person, arrival order never picking a winner. A reply after an outcome SHALL only record what the owner said. A request ID SHALL name one action, ever: the same caller asking for the same action again SHALL get what that action got (`accepted`, its refusal, or `uncertain-result` while its reply is unknown) and nothing SHALL be sent; another action or another caller under that ID SHALL be refused with `duplicate-conflict`. Nothing SHALL ever send a command again: not a timed-out or uncertain one, not after a restart, which SHALL only let each pending operation's deadline pass, ending it `uncertain`. A clean stop closes the core's participant before the core stops, which settles the dispatcher's own requests: an action whose owner's handler has it with no reply SHALL end `uncertain` at once, with `uncertain-result` and the detail `the requester closed before the reply`, not at its deadline, and one still queued SHALL end `rejected` with `cancelled`, failed, never having run. Each step SHALL commit with its history row and each part's rows for it in one transaction, and SHALL be logged once, in the action's trace: `command.queued`, `command.admitted`, `command.rejected` at its code's level and `command.completed` (INFO for success, WARN for a failed, uncertain or conflicting result, and `bunny.reason` `timeout` at a deadline). The tracker's rows with a failed, expired, uncertain or conflicting result SHALL be the rows #923 turns into inbox items.

The exact ONN focused-text family SHALL omit plaintext from durable operations and retain an omitted-payload marker plus a domain-separated private HMAC over canonical caller, request ID, target/key, type, schema, guards and input. Transport time and trace SHALL be excluded. One independently stored private key SHALL have a pinned identity; a missing, replaced or unsafe key SHALL refuse sensitive effects without erasing prior fences. Private identity storage exhaustion SHALL refuse with `capacity` before sending. This exception SHALL preserve normal action tracking and outcome/history semantics for all other commands.

The exact `art-stage` family SHALL omit its payload from durable operations in the same way, under its own digest domain, so a stage's bytes never grow the tracker or enter history. The bytes SHALL still reach the command's responder. Any stored omitted payload, of either family, SHALL forbid creating a replacement private key, and the core SHALL look for one only when no key is pinned. The dispatcher SHALL refuse, with `forbidden` and no operation, `art-request` unless `requestedBy` is `bunny/parts/dashboard`, `art-auto` unless it is `bunny/core`, and `art-stage` and `art-ambient-set` unless it is `bunny/modules/art`.

#### Scenario: Sent, accepted, completed
- **WHEN** an operator's action reaches a module that accepts it and reports its outcome
- **THEN** the operation is `completed` with the outcome's result and evidence, its owner and command kept, and its payload kept except an omitted ONN focused text or art stage; history holds the steps `sent`, `reply accepted` and `outcome completed` with the outcome itself; each change reached the parts; the module got the command once, from `bunny/core`; and the core logged `command.queued`, `command.admitted` and `command.completed` in one trace with the outcome

#### Scenario: A refusal, a stopped module and an expiry
- **WHEN** a module refuses an action, an action's family has no running module, and an action waits behind one the module's handler holds past the reply deadline
- **THEN** the first two are `rejected`, failed with evidence `none` and their codes, the queued one is `expired` and never reached the module, and the held one is `uncertain`; once released its outcome completes it, and history keeps the uncertain step and the outcome

#### Scenario: An outcome deadline
- **WHEN** an accepted action has no outcome by its kind's outcome deadline, on the runtime's clock, and its outcome arrives later
- **THEN** a millisecond earlier it is still `accepted`, at the deadline it is `uncertain` with a WARN record, and the late `failed` outcome completes it while history keeps both; nothing was sent again

#### Scenario: A restart while an action is pending
- **WHEN** the runtime stops while an accepted action waits for its outcome and starts again on the same state directory
- **THEN** the action is still pending, ends `uncertain` at its deadline, is never sent again, and the same request ID answers what it got without sending

#### Scenario: A clean stop while an action is unanswered
- **WHEN** the runtime stops cleanly while the owner's handler holds one action with no reply and a second waits queued behind it, and starts again on the same state directory
- **THEN** the held one answers `uncertain-result`, `the requester closed before the reply`, and is `uncertain` at the stop, not at its deadline, which later adds nothing; the queued one answers `cancelled` and is failed, never having reached the module; and the restart sends neither

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
- **WHEN** the core store is full and an operator sends an ordinary action
- **THEN** it is refused with `unavailable` and the detail `storage-full`, nothing is recorded, and the module never gets the command

#### Scenario: Sensitive semantic duplicates
- **WHEN** an ONN text request repeats with the same semantic content but a different transport timestamp/trace, or repeats after restart
- **THEN** its retained reply is returned without transmission and no plaintext is retained
- **WHEN** caller, target, schema, guards or input differs under the same request ID
- **THEN** duplicate-conflict is returned without an effect

#### Scenario: A stage's bytes are omitted
- **WHEN** a stage is dispatched, repeated, repeated with other bytes, and repeated after a restart
- **THEN** its responder got the whole bytes once; the operation has an empty payload and an omitted marker; neither the core store, its write-ahead log nor the logs hold the bytes; the repeats answer what the first got and send nothing; and other bytes are `duplicate-conflict`

#### Scenario: An art command from another requester
- **WHEN** any source other than a family's one requester asks for that art family
- **THEN** the dispatcher answers `forbidden`, records no operation and delivers nothing

## ADDED Requirements

### Requirement: Core forwarding of art commands

A core part SHALL answer `bunny.cmd.art-dispatch.art`. It SHALL refuse any source other than `bunny/modules/art` with `forbidden`, refuse an invalid or expired command with its validator's error, and forward a valid one through the tracked dispatcher as `art-stage` or `art-ambient-set` to the named target, with `requestedBy` the command's source and the dispatch's request ID. It SHALL never forward `moment-play`, so the art module cannot start a takeover. A module SHALL learn a stage's result by following the `operation` record for its request ID.

#### Scenario: Forwarded once and tracked
- **WHEN** the art module dispatches a stage, and another module sends the same dispatch
- **THEN** the first is one tracked operation requested by the art module and delivered once from `bunny/core`, and the second is `forbidden` with no operation and no delivery

#### Scenario: A lost answer
- **WHEN** a display's handler fails after it took a stage, and the art module repeats the dispatch
- **THEN** each answer is `uncertain-result`, the operation is uncertain, and the stage is delivered once

#### Scenario: A lapsed copy through the tracker
- **WHEN** a display refuses a moment because its copy lapsed
- **THEN** the operation is `rejected` with reply `not-found`, failed with evidence `none`, and is not `expired`

#### Scenario: A cancel admits no work
- **WHEN** a dashboard session cancels a job through `art-request`, including an automatic one, and a control credential sends the same cancel
- **THEN** the session's reaches the art owner, admits no new job and causes no display command, and the credential's is `forbidden` with no operation

#### Scenario: A module follows its stage
- **WHEN** the art module syncs `operation`, dispatches a stage, and the display reports its outcome
- **THEN** the record for the request ID moves from `accepted` with no result to `succeeded`, with no payload

### Requirement: Gateway refusal of core-only art commands

The gateway SHALL refuse `art-auto`, `art-dispatch`, `art-stage` and `art-ambient-set` from any client with `forbidden` before any dispatch. A client's `art-request` SHALL reach the tracker, which admits only a dashboard session's. A client's `moment-play` SHALL be built as version 2.0, which refuses `art`.

#### Scenario: A client asks directly
- **WHEN** a control credential and a dashboard session send each core-only art family, and each sends `art-request`
- **THEN** every core-only family is `forbidden`, the credential's `art-request` is `forbidden`, the session's is accepted, and only that one reaches a responder
