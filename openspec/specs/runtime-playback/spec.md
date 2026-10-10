# runtime-playback Specification

## Purpose
Define the runtime's playback module: one owner of the Sony HT-A9 and the Sonos Move that polls both, publishes the presented source as the core `playback` record and answers `playback-control` with a reply and an outcome, under ADR 0012's policy A. It covers the module's private configuration and the conversion of the old Hub's block, freshness, the presented-source rule, each source's protocol, commands, diagnostics and the simulated speakers. It is source that the cutover installs; it claims no installation or speaker behavior.

## Requirements

### Requirement: One playback module with private speaker configuration

The runtime SHALL host one module, `playback` (module API 1.2), that owns both the Sony HT-A9 and the Sonos Move sources, because the presented-source rule needs both in one owner and modules cannot import each other. Its `configure` SHALL accept a section with exactly an `id`, a routing ID of lowercase letters and digits with single hyphens and at most 128 characters, a `sources` list of one or two speakers in preference order with at most one of each kind, and optionally a `secrets` member, which it does not use. A Sony speaker SHALL be `{kind: "sony", endpoint}` with an endpoint `http://<numeric private or loopback IPv4>:<port>/sony`, and a Sonos speaker `{kind: "sonos", endpoint}` with the exact control URL `http://<numeric private or loopback IPv4>:<port>/MediaRenderer/AVTransport/Control`, neither with credentials, a query or a fragment. Any other section SHALL be refused with `invalid-request` and a fixed detail that repeats no value. The module SHALL name the record's `id` as its one device. A speaker's address SHALL NOT appear in any message, log record, error body or health entry.

#### Scenario: A valid section
- **WHEN** the section names `living-room` and the Move then the HT-A9 at private addresses
- **THEN** the runtime accepts it, the module's device is `living-room`, and its configuration keeps the speakers in that order

#### Scenario: Sections the module refuses
- **WHEN** the section lists no speaker or three, repeats a kind, uses the former `selected` form, adds a member, gives an ID with capitals, underscores, dots, a repeated hyphen or more than 128 characters, or gives an endpoint that is HTTPS, public, named, portless, credentialed, with a query or fragment, or on another path
- **THEN** the runtime refuses the module with `invalid-request`, its detail quotes no address, and the other modules run

#### Scenario: No section
- **WHEN** the configuration file has no `playback` section, or there is no file
- **THEN** the runtime refuses the module with `not-found` and runs the others

### Requirement: Conversion of the Hub's playback block

The module SHALL provide `convertHostPlayback(block)`, which the cutover's installer runs on the old Hub's `host.json` `playback` block. It SHALL check the block as the Hub checked it at its start, apart from the Hub's own aliases: exactly `{id, sources}`, a 1.x ID of 1 to 128 letters, digits, underscores, dots or hyphens that is not an IPv4 address and carries no speaker's address, and the speaker rules above. It SHALL return the module's section with both speakers' addresses in their configured order and nothing else, because the Hub saves no playback preference beyond that order (owner decision 10, 2026-10-06). An ID outside the routing-ID form SHALL be renamed by lowercasing it and turning each run of other characters into one hyphen, or `playback` when nothing is left, and the result SHALL name the old ID. A block the Hub would refuse SHALL be refused with fixed text.

#### Scenario: Both speakers converted
- **WHEN** the block is `living-room` with the Move then the HT-A9
- **THEN** the section is `{id: "living-room", sources: [Move, HT-A9]}` with both addresses, has no other member, and the runtime accepts it

#### Scenario: A 1.x ID renamed
- **WHEN** the block's ID is `HT-A9` or `living_room.1`
- **THEN** the section's ID is `ht-a9` or `living-room-1`, and the result names the old ID

#### Scenario: A block the Hub refused
- **WHEN** the block has an extra member, an address-shaped ID, an ID carrying a speaker's address, a repeated kind or a bad endpoint
- **THEN** the conversion refuses it with `invalid-request`, quoting no address

### Requirement: Polling and observation freshness

The module SHALL read each configured speaker when it starts and then about every two seconds on the runtime's scheduler, each call with a 1.5-second deadline that also ends when the module stops, and SHALL NOT start a read of a speaker while one is in progress. Its start SHALL NOT wait for any read (policy A). Each speaker SHALL keep its own last observation. A successful read, including an unchanged one, SHALL refresh that speaker's observation time; a failed read SHALL report nothing. A speaker SHALL be `available` below 5 seconds of age, `stale` from 5 to under 30 seconds and `unavailable` at 30 seconds or more or before its first observation, where age is the larger of the wall-clock and monotonic ages.

#### Scenario: Unchanged reads
- **WHEN** a speaker keeps reporting the same track
- **THEN** its observation time advances with each read and it stays available

#### Scenario: Reads never overlap
- **WHEN** a speaker answers slower than the poll period
- **THEN** each speaker is still polled again and again, never with two calls in progress at once, and stopping the module ends the polling

#### Scenario: Monotonic and wall-clock age
- **WHEN** the wall clock steps back, or the monotonic clock pauses during a suspend
- **THEN** the speaker still turns stale or unavailable on time

### Requirement: The presented source

The module SHALL present, for the record and for each command's admission, the first speaker in configured order with the highest rank, where a speaker ranks first by reporting a session (a retained observation that is `playing` or `paused`), then by freshness class (`available` over `stale` over `unavailable`), then by configured order.

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

The module SHALL serve the core family `playback` through sync and publish the presented source as `playback/2.1` state, type `org.bunny.playback.updated`, on `bunny.state.playback.<id>`, with the record's `id` as subject. The record SHALL carry `id`, `revision`, `availability`, `observedAtMs` once the presented speaker was ever read, and `playback`: `{"status": "unknown"}` while unavailable, otherwise the presented observation's `player`, trimmed title, artist and album of at most 256 characters, absent rather than empty, and `controls`. It SHALL publish a new revision only when the availability, presented playback or optional artwork changes, including when the presented speaker's last observation crosses 5 and 30 seconds, and SHALL NOT publish for a read that changes nothing else. Each start SHALL publish a new `unavailable` revision before any read answers, and SHALL keep it until every configured speaker's first read since that start has settled, by answering or by failing. A read fails at the latest when one of its calls gets no answer within that call's 1.5-second deadline, so the hold lasts at most about 1.5 seconds for the HT-A9's one call and about 4.5 seconds for the Move's three. Only then SHALL it publish what those reads present, so no revision SHALL come from some speakers' first reads while another's is still in progress. Artwork completion SHALL NOT advance metadata observation evidence or the 5-second and 30-second freshness deadlines. Revisions SHALL rise across restarts. The record SHALL NOT name the presented speaker, its kind or its address.

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

### Requirement: Sony HT-A9 source

The Sony source SHALL read `getPlayingContentInfo` version 1.2 with `[{output: ""}]`, and SHALL normalize the AirPlay entry's title, artist, optional album and state: `PLAYING`, `PAUSED` and `STOPPED` to `playing`, `paused` and `stopped`, and any other state to `unknown`. It SHALL declare pause, next and previous while AirPlay plays, only next and previous while paused, no controls otherwise, and never play. A reply without an AirPlay entry SHALL be `inactive` with no metadata or controls. A JSON-RPC error, an HTTP error, a malformed body, a reply to another ID, a dropped connection or a missed deadline SHALL fail the read. Commands SHALL call `pausePlayingContent` 1.1, `setPlayNextContent` 1.0 or `setPlayPreviousContent` 1.0 once: a result is sent, a JSON-RPC error is a refusal, and no answer is uncertain. An optional thumbnail URL of at most 2,048 characters MAY be retained privately for independent artwork acquisition; it SHALL NOT enter a public playback record, log or error. No other receiver field SHALL be copied.

#### Scenario: Paused AirPlay
- **WHEN** the HT-A9 reports AirPlay `PAUSED` with no album
- **THEN** the observation is paused with next and previous, and no album

#### Scenario: Failed reads
- **WHEN** a read gets an error, an HTTP 500, a non-JSON body, a wrong result, a dropped connection, no answer or another ID
- **THEN** the observation time does not change

### Requirement: Sonos Move source

The Sonos source SHALL read `GetTransportInfo`, `GetPositionInfo` and `GetCurrentTransportActions` in sequence, each a 200 reply carrying its response element within 64 KiB, and any failed call SHALL fail the whole read. It SHALL treat an `x-sonos-vli` track URI as the AirPlay session and any other as `inactive` with no metadata or controls, map `PLAYING`, `PAUSED_PLAYBACK` and `STOPPED` to `playing`, `paused` and `stopped` and any other state to `unknown`, read the DIDL-Lite title, creator and album decoded once per layer, and SHALL NOT copy artwork, position or duration. It SHALL declare pause, next and previous while playing and play, next and previous while paused, each only while the Move's actions list it. Commands SHALL send `Pause`, `Play` with speed 1, `Next` or `Previous` once: HTTP 200 is sent, an HTTP 500 SOAP fault is a refusal, and anything else is uncertain.

#### Scenario: Paused with play advertised
- **WHEN** the Move reports `PAUSED_PLAYBACK` with Play, Next and Previous among its actions
- **THEN** the observation declares play, next and previous

#### Scenario: Command answers
- **WHEN** play gets HTTP 200, next a SOAP fault, previous no answer, and previous an HTTP 500 without a fault
- **THEN** play is sent with `<Speed>1</Speed>`, next is refused, and both previous calls are uncertain

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

### Requirement: Speaker failures and diagnostics

Under policy A a speaker's errors and timeouts SHALL become `unavailable` state and outcomes, never a module failure, and a module whose speakers are offline at start SHALL run, report `unavailable` and refuse commands. The module SHALL log through its context under `bunny.module` only registered events and attributes: one `device.unavailable` warning when a speaker's reads start failing and DEBUG summaries at most once a minute afterwards, one `device.available` record when it answers again, `command.executing` in the command's trace when it sends a command, the outbox's `outcome.published` and `outbox.republished`, one `operation.failed` record per run of database refusals of any commit, a record, an intent or an outcome (WARN, or ERROR for `internal`), and one `operation.completed` record when a commit works again. It SHALL name a speaker in `bunny.device.id` as `<id>.<kind>`, never by address, and SHALL NOT log an exception's text, a title or an address. It SHALL record a `bunny.device.call` span around each command's speaker call, the command's child, and SHALL give no trace context to a speaker.

#### Scenario: Both speakers offline at start
- **WHEN** neither speaker answers when the module starts, and for 20 seconds after
- **THEN** start returns at once, the record stays `unavailable` with one revision, each speaker has one `device.unavailable` warning, a pause is refused `unavailable`, and once both answer the record turns `available` with one `device.available` record each

#### Scenario: The module test kit
- **WHEN** the module runs the module test kit with simulated speakers, one instance of which never answers
- **THEN** every check passes, policy A's offline check included

### Requirement: Simulated speakers

The module SHALL provide `SimulatedSpeakers`, a transport that answers both protocols as the qualified speakers do, so the module's own parsing runs on it, keeps its state when the runtime restarts, and never contacts an address. A test or run SHALL be able to play a track to either speaker, pause, stop or switch it to another input, make it stop answering, answer each call late or answer again at once, and make its next command be refused or never answered. A late answer SHALL wait on the scheduler the test or run gives, real time by default. The runtime's `--simulate` SHALL build the module with it.

#### Scenario: A disposable run
- **WHEN** a run seeded for the speaker-playback scenario plays to the HT-A9, switches to the Move and silences it
- **THEN** the playback record follows, the run reaches no speaker, and its boundary checks pass

### Requirement: Commands before the first reads after a start

A `playback-control` command that reaches its admission before every configured speaker's first read since the module's start has settled SHALL wait for those reads, at most 1.5 seconds, so it goes to the speaker the record will present. If they have still not all settled, the module SHALL refuse the command with `unavailable`, sending nothing. A command whose deadline passed during that wait SHALL NOT be sent: the module SHALL record it and publish `failed` with evidence `none` and `expired`, as for a command that waited for the read ahead. The module's stop SHALL end the wait at once, and the command SHALL be refused `unavailable`, sending nothing. A command right after a start has no read ahead to wait for, so its reply SHALL still come within about 3 seconds.

#### Scenario: A command right after a start
- **WHEN** a pause arrives after a start while the HT-A9 has answered and the Move's first read is still in progress
- **THEN** it waits for the Move's read and goes to the Move once the Move answers playing; if the Move's read has not settled 1.5 seconds after the pause arrived, the pause is refused `unavailable` and reaches no speaker

#### Scenario: A stop while a command waits for the first reads
- **WHEN** the module stops while a pause waits for the Move's first read after a start
- **THEN** the stop returns at once, leaves no timer behind, and the pause is refused `unavailable` and reaches no speaker

#### Scenario: A command that expires while the first reads run
- **WHEN** a pause with a 1-second deadline arrives right after a start, while the Move takes 3 seconds over its first read
- **THEN** the SDK answers it `uncertain-result` at its deadline, no speaker hears it, and its outcome is `failed` with evidence `none` and `expired`

### Requirement: Playback storage uses SDK full-disk classification
The playback module SHALL classify storage errors with the SDK full-disk helper while preserving explicit `SdkError` codes. A wrapped SQLite `SQLITE_FULL` or filesystem `ENOSPC` SHALL retain the existing capacity response and no-command-before-durable-intent behavior. SQLite `BUSY` and `LOCKED` SHALL remain unavailable.

#### Scenario: Wrapped ENOSPC refuses command intent
- **WHEN** recording a command intent fails with an error caused by `ENOSPC`
- **THEN** the command receives the existing capacity response and the speaker receives no command

### Requirement: Optional shared Sony artwork

The playback owner SHALL acquire optional Sony artwork independently of metadata and controls. It SHALL fetch only an absolute HTTP URL on the configured receiver's origin, without credentials or a fragment, and SHALL refuse redirects. Acquisition SHALL ignore HTTP media-type claims, admit JPEG or PNG bytes, and normalize a single image to a metadata-free PNG no larger than 128×128 and 65,536 bytes. Input SHALL be limited to 1,048,576 bytes and 4,000,000 decoded pixels. Fetch and worker decode SHALL each have a 2,000 ms deadline. At most one acquisition chain SHALL be admitted at a time, with only the newest replacement retained. Failures SHALL retain text-only playback and current control routing, with safe diagnostics that expose no URL, image bytes or listening metadata.

#### Scenario: Qualified JPEG with an incorrect media type
- **WHEN** the presented Sony source reports a same-origin JPEG thumbnail served as `text/plain`
- **THEN** metadata is published without waiting for the image and a bounded normalized PNG is subsequently shared

#### Scenario: Invalid or absent image
- **WHEN** content is absent, bytes cannot be decoded, the origin is different, a redirect occurs, a deadline expires or any capacity limit is exceeded
- **THEN** the image remains missing and playback text, availability and controls remain governed by metadata

### Requirement: Artwork follows the presented observation

Artwork SHALL carry an opaque generation that changes on a presented source or reported track change, loss of the eligible playing/paused session, unavailable playback or restart. A generation SHALL persist through duplicate polls, playing/paused transitions and freshness-only changes. Candidate replacement SHALL invalidate earlier pending results even within the same generation. The owner SHALL retain only current artwork, deduplicate acquired candidates and permit at most three transient attempts per candidate and generation, spaced by bounded backoff. A later candidate after absent content SHALL be eligible for acquisition. Image completion SHALL NOT refresh metadata evidence or trigger a new-track presentation. Sonos SHALL publish unsupported artwork and SHALL NOT inherit Sony artwork. Metadata that the receiver has not yet reported SHALL NOT be inferred.

#### Scenario: Late artwork after a handoff
- **WHEN** Sony artwork is pending and Sonos becomes presented with identical text
- **THEN** the generation changes, Sonos is unsupported and the late Sony result cannot restore an image

#### Scenario: Same observation receives artwork later
- **WHEN** duplicate metadata initially lacks a candidate and later reports one
- **THEN** the current generation can become ready without changing the track, freshness evidence or presentation timer

#### Scenario: Stop and restart
- **WHEN** the module stops while fetching or decoding and then restarts
- **THEN** pending work is aborted, cannot publish and cannot restore the previous image

### Requirement: Passive reads of current playback artwork

The playback owner SHALL provide its current bounded normalized PNG through its authenticated module content contribution, addressed by artwork generation and playback record revision. Content SHALL be available only for the exact current available, known playing or paused Sony observation whose committed ready record matches the owner's current artwork and metadata. Malformed, missing, obsolete, stale, unavailable, stopped or mismatched references SHALL return the existing safe missing-content result. Stop and abort SHALL retire content from that run. A read SHALL perform no receiver fetch, worker decode, publication, revision change, freshness reset or command. It SHALL expose neither a receiver URL nor credentials, listening metadata or native exception text. The existing gateway read authority, no-store and nosniff policies SHALL protect the returned PNG.

#### Scenario: Several consumers read the same thumbnail
- **WHEN** multiple authorized read-only consumers request the current ready thumbnail
- **THEN** they receive the same bounded PNG without another acquisition, decode, state publication or command

#### Scenario: Replacement precedes publication
- **WHEN** the owner has moved to another candidate or observation while the committed record still identifies earlier artwork
- **THEN** the earlier reference returns missing content until the exact current ready record and private snapshot agree

#### Scenario: Generation persists while the record changes
- **WHEN** a playing-to-paused transition or same-generation candidate replacement publishes a newer record revision
- **THEN** its new reference is distinct, the old revision reference returns missing content, and only the current matching ready image is served

#### Scenario: Source, freshness and run boundaries
- **WHEN** the presented source becomes Sonos, playback becomes stale, unavailable or inactive, publication rolls back, or the module stops or restarts
- **THEN** previously issued image references cannot serve obsolete artwork and content reads cause no recovery effect

#### Scenario: Authority and safe errors
- **WHEN** an unauthenticated caller, an authenticated caller without read authority, or an authorized caller with an obsolete or absent artwork reference requests content
- **THEN** the existing gateway returns respectively its safe authentication, authorization or missing-content response without echoing private input, malformed gateway references retain the existing input refusal, and valid content uses image/png, no-store and nosniff
