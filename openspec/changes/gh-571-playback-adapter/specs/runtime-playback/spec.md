## MODIFIED Requirements

### Requirement: One playback module with private speaker configuration

The runtime SHALL host one module, `playback` (module API 1.2), that owns the Sony HT-A9, Sonos Move and optional Mac Music sources, because the presented-source rule needs both in one owner and modules cannot import each other. Its `configure` SHALL accept a section with exactly an `id`, a routing ID of lowercase letters and digits with single hyphens and at most 128 characters, a `sources` list of one to three sources in preference order with at most one of each kind, and optionally a `secrets` member, which it does not use. A Sony speaker SHALL be `{kind: "sony", endpoint}` with an endpoint `http://<numeric private or loopback IPv4>:<port>/sony`, and a Sonos speaker `{kind: "sonos", endpoint}` with the exact control URL `http://<numeric private or loopback IPv4>:<port>/MediaRenderer/AVTransport/Control`, neither with credentials, a query or a fragment. A Music source SHALL be exactly `{kind: "music"}` and SHALL be absent unless explicitly configured. Any other section SHALL be refused with `invalid-request` and a fixed detail that repeats no value. The module SHALL name the record's `id` as its one device. A speaker's address SHALL NOT appear in any message, log record, error body or health entry.

#### Scenario: A valid section
- **WHEN** the section names `living-room` and the Move then the HT-A9 at private addresses
- **THEN** the runtime accepts it, the module's device is `living-room`, and its configuration keeps the speakers in that order

#### Scenario: Sections the module refuses
- **WHEN** the section lists no source or more than three, repeats a kind, uses the former `selected` form, adds a member, gives an ID with capitals, underscores, dots, a repeated hyphen or more than 128 characters, or gives an endpoint that is HTTPS, public, named, portless, credentialed, with a query or fragment, or on another path
- **THEN** the runtime refuses the module with `invalid-request`, its detail quotes no address, and the other modules run

#### Scenario: No section
- **WHEN** the configuration file has no `playback` section, or there is no file
- **THEN** the runtime refuses the module with `not-found` and runs the others

### Requirement: The presented source

The module SHALL present, for the record and for each command's admission, the first source in configured order with the highest rank, where a source ranks first by reporting a session (a retained observation that is `playing` or `paused`), then by freshness class (`available` over `stale` over `unavailable`), then by configured order.

#### Scenario: Sony alone, then grouped
- **WHEN** the Move reports another input and the HT-A9 plays, and then the Move, configured first, plays too
- **THEN** the HT-A9 is presented first, and then the Move

#### Scenario: Move offline mid-song
- **WHEN** the Move was playing and stops answering while the HT-A9 reports another input
- **THEN** the Move stays presented as stale for up to 30 seconds, and then the HT-A9 is presented

#### Scenario: Nothing playing
- **WHEN** no speaker reports playing or paused
- **THEN** the freshest speaker is presented, ties going to configured order

### Requirement: The playback record

The module SHALL serve the core family `playback` through sync and publish the presented source as `playback/2.1` state, type `org.bunny.playback.updated`, on `bunny.state.playback.<id>`, with the record's `id` as subject. The record SHALL carry `id`, `revision`, `availability`, `observedAtMs` once the presented speaker was ever read, and `playback`: `{"status": "unknown"}` while unavailable, otherwise the presented observation's `player`, trimmed title, artist and album of at most 256 characters, absent rather than empty, and `controls`. It SHALL publish a new revision only when the availability, presented playback, optional artwork or presented source/process generation changes, including when the presented speaker's last observation crosses 5 and 30 seconds, and SHALL NOT publish for a read that changes nothing else. A configured Music slot without an admitted observation SHALL settle unavailable promptly and SHALL NOT hold receiver startup. Each start SHALL publish a new `unavailable` revision before any read answers, and SHALL keep it until every configured speaker's first read since that start has settled, by answering or by failing. A read fails at the latest when one of its calls gets no answer within that call's 1.5-second deadline, so the hold lasts at most about 1.5 seconds for the HT-A9's one call and about 4.5 seconds for the Move's three. Only then SHALL it publish what those reads present, so no revision SHALL come from some speakers' first reads while another's is still in progress. Artwork completion SHALL NOT advance metadata observation evidence or the 5-second and 30-second freshness deadlines. Revisions SHALL rise across restarts. The record SHALL NOT name the presented speaker, its kind or its address.

#### Scenario: Startup
- **WHEN** the module starts and no speaker has answered yet
- **THEN** it publishes an `unavailable` record with unknown playback, then, once every speaker's first read has settled, the record those reads present

#### Scenario: A slower second speaker
- **WHEN** after a start the HT-A9, on another input, answers at once, and the Move, configured first and playing, answers its first read 1.2 seconds later
- **THEN** the record stays `unavailable` until the Move's read answers, and its next revision shows the Move's song playing, never the HT-A9's other input

#### Scenario: A speaker that never answers at start
- **WHEN** after a start the HT-A9 plays and answers at once, and the Move never answers
- **THEN** the record stays `unavailable` until the Move's first call reaches its 1.5-second deadline, then shows the HT-A9 playing, and the Move's outage is logged once

#### Scenario: A silent speaker
- **WHEN** the only speaker stops answering after a successful read
- **THEN** a `stale` revision keeping the last playback is published exactly 5 seconds after that read, an `unavailable` revision with unknown playback exactly 30 seconds after it, nothing in between, and the next successful read publishes an `available` revision

#### Scenario: Restart
- **WHEN** the module restarts on the same database
- **THEN** its revisions continue above the last one it published

### Requirement: Playback commands

The module SHALL answer `playback-control` on `bunny.cmd.playback-control.<id>`, one command at a time. A command whose subject is not the record's `id` never reaches it: the bus refuses it with `invalid-message` (`bunny-message-profile`, "A message's subject is its key's routing ID"). It SHALL refuse, sending nothing: an unknown action or a non-integer `expectedRevision` with `invalid-request`; any command while it stops, and any while the presented speaker is not `available`, with `unavailable`; a `requestId` the same requester used for another command with `duplicate-conflict`; an `expectedRevision` other than the record's current revision with `revision-conflict`; an action the presented speaker does not offer now with `unsupported-capability`; and a command whose intent it cannot store with `capacity`. A command the same requester sent before with the same `requestId` SHALL be accepted again and send nothing; the module SHALL remember the last 64 commands, across restarts. A queued command's admission SHALL wait, at most 1.5 seconds, for the read of the speaker that follows the command ahead of it, so it is checked against what that speaker reports afterwards. Otherwise the speaker presented at admission SHALL be fixed: the module SHALL store the command's intent before the speaker hears it, send the action to that source once, with the existing 1.5-second receiver deadline or a four-second initial wait for Music transmission evidence, and never redirect or retry it, even when another speaker takes over meanwhile; the module's stop SHALL end the call at once. It SHALL commit the outcome, `org.bunny.playback.control.completed` on `bunny.event.playback-control.<id>`, and publish it through its outbox before it replies `accepted`: `succeeded` with evidence `transmitted` when the speaker took it, `failed` with evidence `transmitted` and `invalid-state` when the speaker answered with a refusal, because it heard the command, `failed` with evidence `none` and `unsupported-capability` when the speaker has no command for the action and nothing was sent, and `uncertain` with evidence `none` and `uncertain-result` when it did not answer. As an exception to ADR 0012's "Replies answer a command immediately", the reply SHALL come after the speaker's call and the outcome's commit: the responder handles one command at a time, a receiver call is bounded at 1.5 seconds and the wait for the read ahead at another 1.5 seconds, so a command that finds the module idle gets its reply within about 3 seconds, inside a requester's usual 5-second deadline, and one queued behind a command whose speaker does not answer within about 6 seconds. Music uses a four-second initial owner wait, so the caller can time out before its later outcome; this never authorizes another transmission. A command whose deadline passed while it waited for the read ahead SHALL NOT be sent: the module SHALL record it and publish `failed` with evidence `none` and `expired`, the definitive outcome after the SDK's `uncertain-result`. When the database refuses the outcome after the speaker heard the command, the module SHALL still reply `accepted`, never a refusal, SHALL commit the outcome again after 1 second, doubling the wait up to 60 seconds, and SHALL NOT let the refusal escape the module. Music work SHALL also retain the exact endpoint/process epoch and original expiry. A valid definitive result for that same live operation after initial uncertainty SHALL pass through the existing journal/outbox and ADR0012 late-evidence reconciliation; retired endpoint/process results SHALL NOT affect a new generation. At its start the module SHALL report each stored intent that has no outcome as `uncertain` and never send it.

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

## ADDED Requirements

### Requirement: Qualified Music input and companion evidence

The module SHALL admit one Music endpoint only when Music is configured and the
fixed authenticated producer registers its declared library scope. It SHALL
preserve source-derived observation times, refuse reordered or clock-invalid
samples, and immediately disable Music controls on explicit process/permission
loss. The original source ranking and receiver polling SHALL remain unchanged.
It SHALL serve `playback-position/2.0` under the same stable playback ID, carrying
source/process/item/position/declared-output evidence with explicit unavailability
and no recording or speaker-time qualification. A receiver presentation SHALL
never reuse the last Music evidence. The owner SHALL maintain one sync high-water
revision, commit related records/outbox entries atomically, preserve ordinary
playback revisions across position-only updates and publish unavailable evidence
above the stored high-water mark after restart.

#### Scenario: Paused Music and a playing receiver
- **WHEN** fresh paused Music is configured before a fresh playing receiver
- **THEN** Music is presented under the accepted session/freshness/order rule and only Music receives an admitted listed control

#### Scenario: Same text on a different source
- **WHEN** the presented source or Music process changes while its text is identical
- **THEN** the playback revision advances, earlier guarded controls refuse and receiver artwork cannot follow the Music handoff

#### Scenario: Position updates and mixed sync
- **WHEN** only Music position changes and a consumer syncs both state families
- **THEN** the companion state advances under the owner high-water revision without changing ordinary playback admission revision

#### Scenario: Storage refuses source state or intent
- **WHEN** a transaction cannot persist its revision/outbox entries or a command intent
- **THEN** no partial state commit occurs and a refused command intent sends no native work; retrying an outcome commit never resends an event

#### Scenario: Existing configuration and restart
- **WHEN** the runtime uses its unchanged Sony/Sonos section or restarts with an unfinished Music command
- **THEN** receiver behavior remains unchanged, the unfinished command is uncertain without replay and old Music position is unavailable
