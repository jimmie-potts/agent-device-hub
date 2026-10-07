## MODIFIED Requirements

### Requirement: Playback commands

The module SHALL answer `playback-control` on `bunny.cmd.playback-control.<id>`, one command at a time. A command whose subject is not the record's `id` never reaches it: the bus refuses it with `invalid-message` (`bunny-message-profile`, "A message's subject is its key's routing ID"). It SHALL refuse, sending nothing: an unknown action or a non-integer `expectedRevision` with `invalid-request`; any command while it stops, and any while the presented speaker is not `available`, with `unavailable`; a `requestId` the same requester used for another command with `duplicate-conflict`; an `expectedRevision` other than the record's current revision with `revision-conflict`; an action the presented speaker does not offer now with `unsupported-capability`; and a command whose intent it cannot store with `capacity`. A command the same requester sent before with the same `requestId` SHALL be accepted again and send nothing; the module SHALL remember the last 64 commands, across restarts. A queued command's admission SHALL wait, at most 1.5 seconds, for the read of the speaker that follows the command ahead of it, so it is checked against what that speaker reports afterwards. Otherwise the speaker presented at admission SHALL be fixed: the module SHALL store the command's intent before the speaker hears it, send the action to that speaker once within 1.5 seconds, and never redirect or retry it, even when another speaker takes over meanwhile; the module's stop SHALL end the call at once. It SHALL commit the outcome, `org.bunny.playback.control.completed` on `bunny.event.playback-control.<id>`, and publish it through its outbox before it replies `accepted`: `succeeded` with evidence `transmitted` when the speaker took it, `failed` with evidence `transmitted` and `invalid-state` when the speaker answered with a refusal, because it heard the command, `failed` with evidence `none` and `unsupported-capability` when the speaker has no command for the action and nothing was sent, and `uncertain` with evidence `none` and `uncertain-result` when it did not answer. As an exception to ADR 0012's "Replies answer a command immediately", the reply SHALL come after the speaker's call and the outcome's commit: the responder handles one command at a time, the call is bounded at 1.5 seconds and the wait for the read ahead at another 1.5 seconds, so a command that finds the module idle gets its reply within about 3 seconds, inside a requester's usual 5-second deadline, and one queued behind a command whose speaker does not answer within about 6 seconds. A command whose deadline passed while it waited for the read ahead SHALL NOT be sent: the module SHALL record it and publish `failed` with evidence `none` and `expired`, the definitive outcome after the SDK's `uncertain-result`. When the database refuses the outcome after the speaker heard the command, the module SHALL still reply `accepted`, never a refusal, SHALL commit the outcome again after 1 second, doubling the wait up to 60 seconds, and SHALL NOT let the refusal escape the module. At its start the module SHALL report each stored intent that has no outcome as `uncertain` and never send it.

#### Scenario: Pause goes to the presented speaker only
- **WHEN** the HT-A9 alone plays and the operator pauses, then the Move plays and the operator pauses again
- **THEN** the HT-A9 gets one pause, the Move one pause, and each outcome is succeeded, transmitted, published once

#### Scenario: Command after the presented source changed
- **WHEN** a client read the Move's controls, the Move then leaves AirPlay so the HT-A9 is presented, and the client sends play, or pause with the revision it read
- **THEN** play is refused `unsupported-capability`, pause `revision-conflict`, and no speaker hears either

#### Scenario: No redirect and no retry
- **WHEN** the Move takes a pause but never answers, and the HT-A9 is presented before its deadline
- **THEN** the outcome is uncertain, the Move heard pause once, the HT-A9 nothing, and sending the same request again is accepted and sends nothing, while another command under that `requestId` is refused `duplicate-conflict`

#### Scenario: Two commands at once
- **WHEN** a second command arrives while the first waits for the speaker
- **THEN** the second waits, and is admitted against the speaker presented once the first has its outcome

#### Scenario: A command that expires while it waits
- **WHEN** a command with a 1-second deadline waits behind one whose speaker then stops answering reads
- **THEN** the SDK answers it `uncertain-result` at its deadline, no speaker hears it, its outcome is `failed` with evidence `none` and `expired`, and the same request again is accepted and sends nothing

#### Scenario: A command queued behind another
- **WHEN** two pauses reach the playing HT-A9 at once, and then a pause and a play reach the playing Move at once
- **THEN** the first pause is sent and the second refused `unsupported-capability`, because the HT-A9 then reports paused, and both the Move's pause and its play are sent

#### Scenario: A speaker that refuses
- **WHEN** the HT-A9 answers a previous with a JSON-RPC error
- **THEN** the outcome is `failed` with evidence `transmitted` and `invalid-state`

#### Scenario: Intent first, reply last
- **WHEN** a command is sent while the module's outcome publications are held
- **THEN** the speaker hears it only after its intent is stored, and the requester hears `accepted` only once the outcome is committed and published

#### Scenario: A stop during a call
- **WHEN** the module stops while a speaker has not answered a command
- **THEN** the stop ends the call at once, leaves no call or timer behind, stores the outcome as `uncertain`, and the next start publishes it

#### Scenario: The database refuses the intent
- **WHEN** the module's database refuses every write and two commands arrive, and then it takes writes again and a third arrives
- **THEN** both are refused `capacity` with no speaker hearing them and one `operation.failed` record, and the third is sent, with one `operation.completed` record

#### Scenario: The database still refuses when the module stops
- **WHEN** the database refuses commits from the moment the speaker hears a command, and the module stops before the speaker answers
- **THEN** the stop leaves no handler failure and no retry timer, the intent stays without an outcome, and once the database lets go the next start publishes one `uncertain` outcome and sends nothing

#### Scenario: The database refuses the outcome
- **WHEN** the database refuses commits from the moment the speaker hears a command until a few seconds later
- **THEN** the requester hears `accepted`, the module keeps running with its intent stored, logs one `operation.failed` record, commits and publishes the outcome once the database lets go, logs one `operation.completed`, and sends later commands

#### Scenario: A crash between intent and outcome
- **WHEN** the module starts with a stored intent that has no outcome
- **THEN** it publishes that command's outcome as uncertain, sends nothing, and answers the same request again as accepted

#### Scenario: Bounded memory of commands
- **WHEN** 65 distinct commands are sent
- **THEN** repeating the second sends nothing, and repeating the first sends again
