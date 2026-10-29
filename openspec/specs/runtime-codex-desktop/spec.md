# runtime-codex-desktop Specification

## Purpose
Define the Codex Desktop runtime module under ADR 0012 (Hub #926): its section and the optional legacy conversion of the Hub's setting, the read evidence that Codex Desktop's read marker gives the core's top-level Desktop sessions, reading the marker in a process of its own under policy A, what leaves the module, and the simulated marker its tests and disposable runs use. It is source; the cutover (#840) installs it.

## Requirements

### Requirement: Codex Desktop configuration and optional legacy conversion

The runtime SHALL host one module, `codex-desktop` (module API 1.2), that turns Codex Desktop's read marker, archive filenames and index titles into evidence for the core's sessions. Its `configure` SHALL accept the released section with exactly the old Hub's `codexDesktop` members: `home`, an absolute, normalized path of at most 1024 characters without a NUL, which may lie on a Windows mount, and `hostId` and `sourceId`, each 1 to 128 letters, digits, underscores, dots or hyphens; it SHALL read that section as one local source and show its settings as before. It SHALL also accept a section with exactly `sources` (Hub #567): 1 to 4 sources, each with `hostId` and `sourceId` so checked and an optional `home` so checked, where a source with a `home` is read locally and one without is a remote source, and no two sources name the same host and source. A section that mixes the two forms, or any other member but the runtime's `secrets`, SHALL be refused. The runtime's `secrets` member SHALL be ignored, and the module SHALL read no secret. A refusal SHALL be `invalid-request` with fixed text that repeats no value. `convertHubCodexDesktop(hostConfiguration)` SHALL turn the old Hub's host configuration into the released section, give undefined when the Hub has no `codexDesktop`, refuse a `sources` setting, and check the result with the module's own `configure`. The module's settings SHALL show `hostId` and `sourceId` for the released section and, for `sources`, each source's `hostId`, `sourceId` and whether it is remote, never a home. A runtime without the module's section SHALL refuse it with `not-found` and run on.

#### Scenario: Sections
- **WHEN** the section is the Hub's valid setting, on a Windows mount or not, with or without the runtime's `secrets` member, or adds a member, misses one, gives a relative or unnormalized home, a home with a NUL or over 1024 characters, or an ID with a space, empty or over 128 characters
- **THEN** the runtime admits the valid sections and refuses the others with `invalid-request`, whose detail repeats none of the values; without a section the module is refused with `not-found`

#### Scenario: The sources form
- **WHEN** a section lists one remote source, a local and a remote source, four distinct sources, or lists none, five, a source with an extra or missing member, an invalid home or ID, the same host and source twice or once locally and once remotely, or mixes `sources` with `home`, `hostId` or `sourceId`
- **THEN** the valid lists are admitted and shown with each source's kind and no home, and the others are refused with `invalid-request` and fixed text

#### Scenario: Optional legacy conversion
- **WHEN** the conversion reads a Hub configuration with a valid `codexDesktop`, one without it, and ones whose setting is malformed, carries `secrets` or lists `sources`
- **THEN** it gives the setting as the section, gives undefined, and refuses the others with `invalid-request`

### Requirement: Read evidence for top-level Desktop sessions

The module SHALL follow the core's sessions through sync, read the marker every 2 s, and for each session whose read state the marker changes publish one `org.bunny.lifecycle.observed` occurrence with a `read-observed` event, from `bunny/modules/codex-desktop`, on `bunny.event.lifecycle.<session ID>`, with the session's identity and turn, an unknown parent and unknown ordering. The old Hub's rules SHALL hold: only the configured producer's Codex Desktop sessions count, and never a subagent with a known parent; a listed session is unread; an unlisted one is read once it was unread, or, when its read state is unknown and its activity is not `active`, once 5 s have passed since its last evidence. Only the known version 1 marker shape SHALL count; a missing, unreadable, oversized (over 16 MiB), malformed or other-format marker SHALL give no evidence, and a marker that changed while it was read SHALL give none until it is read again. The module SHALL publish evidence at once for a new revision of a session's record. While that revision stays the same, as when the core refused the observation, the module SHALL send the same evidence again on a later poll: first 4 s after it went out, then after a wait that doubles each time, at most a minute. It SHALL log each change of the marker's usability once.

#### Scenario: The marker's sessions
- **WHEN** the marker lists a finished top-level Desktop session, its subagent, another producer's Desktop session, a CLI session, another host's session and a Claude session
- **THEN** only the top-level Desktop session gets `unread`, and `read` once the marker no longer lists it, and nothing more while neither changes

#### Scenario: The settle rule
- **WHEN** the marker lists nothing, a session finished, one was interrupted and one runs
- **THEN** the first two read as read only once 5 s have passed since their last evidence, and the running one never does

#### Scenario: An unusable marker
- **WHEN** the marker turns into another format while one session is listed and another finishes, then becomes usable again
- **THEN** no evidence comes while it is unusable, both sessions read as read once it is usable, and one warning and one recovery are logged

#### Scenario: Evidence the core refuses
- **WHEN** the core refuses a session's read evidence once, as while its store fails, and then takes it
- **THEN** the module sends it again on the first poll 4 s after it went out, the session's read state follows the marker, and nothing more is sent

#### Scenario: Evidence the core never takes
- **WHEN** the core leaves a session's record unchanged after its evidence
- **THEN** the module sends it again 4, 8, 16, 32 and 60 s later, then once a minute, and at once when the record's revision changes

#### Scenario: Through the real core
- **WHEN** the runtime runs the real core and the module's real reader on a synthetic marker in a temporary Codex home, and a Desktop session's turn ends while the marker lists it, beside a subagent and another producer's session
- **THEN** the core marks the session unread, then read once the marker drops it, takes both observations from the module, leaves the subagent and the other session unknown, and the Codex home holds only the marker

### Requirement: Reading the marker under policy A

The marker's folder SHALL be the module's device under policy A. Start SHALL never wait on it. The real reader SHALL read the marker in a child process of its own, started on the first read and again after it ended, given the home over its IPC channel and never in its arguments, never keeping the runtime alive, and never blocking on a special file. It SHALL read asynchronously, so that when its channel closes, even while a read is stuck, it ends itself at once by signal. The module SHALL publish evidence only from a read that answered. A read that does not answer within 5 s SHALL make the marker unavailable, logged once as a `device.unavailable` warning with `bunny.device.id` `marker` and then as summaries, and the module SHALL not read again until that read answers, when one `device.available` record follows. A reader that fails SHALL make the marker unavailable and be tried again after 2 s times 2 to the number of failures in a row, at most a minute. The module's stop SHALL never wait on a read, and SHALL end the reader. The folder's errors and stalls SHALL never fail the module or reach the core or any other module.

#### Scenario: A folder that stalls
- **WHEN** the folder stalls after a good read while the marker changes, for a minute, then answers
- **THEN** one warning is logged, one read waits, nothing is published meanwhile, and once it answers one recovery is logged and the evidence follows the new marker; the module never fails

#### Scenario: A folder that stalls from the start
- **WHEN** the module starts with its folder already stalled
- **THEN** its start returns at once, the marker is unavailable after 5 s, and evidence follows once the folder answers

#### Scenario: A reader that fails
- **WHEN** the reader fails four times in a row, then reads
- **THEN** the reads come 4, 8, 16 and 32 s apart, then every 2 s, with one warning and one recovery

#### Scenario: A stop during a stalled read
- **WHEN** the module stops while a read waits on its folder
- **THEN** the stop returns at once, ends the reader and leaves no timer

#### Scenario: A reader stuck in a file system call
- **WHEN** the real reader is stuck in an `open` that never returns, in the runtime with the real core
- **THEN** the core still takes observations, health shows the module and the core running, the marker is unavailable once, and the runtime's stop finishes within 3 s; closing the transport ends the stuck reader

#### Scenario: A runtime killed during a stall
- **WHEN** the process that started the real reader's loop is killed outright while the reader is stuck in an `open` that never returns
- **THEN** the reader is gone within 2 s

### Requirement: What leaves the Codex Desktop module

Only `read-observed` and `metadata-observed` lifecycle observations of Codex Desktop sessions SHALL reach the bus from the module, which SHALL send no command, and only the unread thread IDs, the archive filename IDs and validated titles SHALL leave the reader's process. The marker SHALL only be read. No message, record, setting or health entry SHALL carry a Codex home or the marker's content. For a remote source the module SHALL subscribe to `bunny.event.desktop-metadata.*` and sync the core's sessions, and nothing else.

#### Scenario: Nothing carries the Codex home
- **WHEN** the module reads, publishes evidence, finds the marker unusable and its folder stalled, with a home on a Windows mount
- **THEN** every message it published is a Codex Desktop lifecycle observation, it sent only its sync of the sessions, and no message, record or setting holds any part of the home's path

### Requirement: Simulated marker and acceptance tiers

The module SHALL come with `SimulatedMarker`, which lists unread threads, turns unusable, stalls every read until it answers again, fails a read, and reports its state, and its factory SHALL build the module with it under `--simulate`, with a simulated section whose home is never read. The catalog scenario `codex-desktop-read` SHALL run the module with the simulated marker in the in-memory harness on both transports and in disposable runs, where the supervisor holds the marker and the runtime's child reaches it over its IPC channel without a path. The module SHALL pass the module test kit.

#### Scenario: The catalog scenario
- **WHEN** `codex-desktop-read` runs in process, through the edge and in a disposable run: a Desktop turn and its subagent's end, the marker lists both, clears the flag, turns unusable while another turn ends, is written again, then the Codex home stalls while another turn ends and answers again
- **THEN** the top-level session reads unread, then read; the subagent stays unknown; the unusable marker gives no evidence for 8 s; the finished session reads read once it is usable; the stall logs one `device.unavailable` warning while the core still takes the new session and the module runs; and once the home answers one `device.available` record follows and the session reads read

### Requirement: Desktop archive admission and independent titles

The module SHALL read positive archive filename evidence and validated provider titles from the existing session_index.jsonl input in its child reader, independently of marker usability. It SHALL publish metadata-observed in the existing lifecycle family. Only the configured Codex Desktop producer and top-level titles qualify. The core SHALL accept metadata observations only from the Codex Desktop module, guard new session admission and ancestor admission from scoped positive archive evidence, and preserve existing sessions. Missing, unreadable or stalled evidence SHALL fail open. Positive archive evidence SHALL refresh every 2 s, clear when no longer confirmed and expire after 7 s. Title metadata SHALL update existing sessions without changing labels, lifecycle evidence timestamps, host session IDs, activity, read, turn, ordering, notices or restart uncertainty.

#### Scenario: Late hook for an archived conversation
- **WHEN** a positive rollout filename names an archived Desktop conversation and a late root or descendant hook arrives
- **THEN** admission refuses it while other hosts and sources remain admitted

#### Scenario: Unarchive and unavailable evidence
- **WHEN** the archive entry disappears or the archive source becomes unavailable or stalls
- **THEN** positive admission evidence clears or expires, and fresh work can be admitted without blocking the core

#### Scenario: Desktop title with a missing marker
- **WHEN** a known top-level Desktop session has a valid session_index.jsonl title and the read marker is missing
- **THEN** its provider title appears, an explicit user label remains the display winner, and lifecycle freshness stays unchanged

#### Scenario: Untrusted metadata publication
- **WHEN** a remote producer sends metadata-observed or attempts to take the module source
- **THEN** it cannot establish archive evidence or overwrite a title

### Requirement: Remote Desktop sources

For a source without a `home` the module SHALL take `desktop-metadata` snapshots (see the shared event contract) as that source's reads, under the same read, settle, archive-expiry, title and resend rules as a local source (Hub #567). It SHALL take a snapshot only when its envelope source is a remote part (`bunny/parts/...`), its subject is the configured feed's ID and its feed is that source with `client: desktop`; any other snapshot on those keys SHALL change nothing and SHALL be logged once per sender and key, `forbidden` at WARN or `not-found` at INFO for a feed the module does not follow. A read SHALL answer from the latest snapshot received less than 10 s ago, as `unchanged` when its stamp is the one the module holds; without a fresh snapshot a read SHALL wait for the next one, so the existing 5 s deadline makes the marker unavailable, logged once, with archive positives cleared, and the next snapshot SHALL answer the waiting read at once and log the recovery. A snapshot whose `observedAtMs` is not newer than the last one taken for its feed SHALL be ignored, noted at DEBUG, and SHALL neither renew the feed's freshness nor reorder evidence; the settle rule SHALL measure from the receipt of the snapshot a read answers from, never from a later poll. Each source SHALL have its own marker device in records, `marker` alone when one source is configured, `marker:<hostId>:<sourceId>` otherwise, or `marker:` and 32 hex digits of the pair's SHA-256 when that name would pass the record contract's 128 characters, and the marker's usability records SHALL name it; every observation SHALL carry its own source's identity, so the same thread ID on two sources is two sessions, and an observation drawn from a snapshot SHALL continue that snapshot's trace. The module SHALL read no local file for a remote source.

#### Scenario: Snapshots as reads
- **WHEN** a collector's snapshot lists one session as unread, names an archived conversation and a title, then a heartbeat repeats the same stamp, then a snapshot clears the flag
- **THEN** the session reads unread, the archive positive and the title are published for that source's identity, the heartbeat gives no new evidence, and the session reads read

#### Scenario: A feed that stops
- **WHEN** no snapshot arrives for 10 s and then 5 s more, for a minute, and then one arrives
- **THEN** one `device.unavailable` warning is logged, archive positives are cleared, no read state changes meanwhile, and the next snapshot logs one `device.available` record and its evidence follows

#### Scenario: A late snapshot
- **WHEN** a snapshot observed before the feed's last one arrives after it, and a session ended 1 s before the latest snapshot was received
- **THEN** the late snapshot changes nothing and renews no freshness, and the session settles to read only from a snapshot received 5 s or more after its last evidence

#### Scenario: Refused snapshots
- **WHEN** snapshots arrive for an unconfigured feed, twice from the same sender, for the configured feed on another feed's key, and from the core's own source
- **THEN** nothing changes, two records are logged (`not-found` at INFO, `forbidden` at WARN), and the configured feed's next snapshot on its own key still counts

#### Scenario: A local and a remote source together
- **WHEN** a section lists a local and a remote source, the local marker lists a thread ID the remote feed does not, and the local folder then stalls while snapshots go on
- **THEN** the local host's session reads unread and the remote host's reads read, only the local marker device is unavailable, and each observation names its own source

#### Scenario: Through the real core and the edge
- **WHEN** the runtime runs the real core and the module with a remote source, and the collector's own ingest credential publishes snapshots through the edge, beside a hook credential and a snapshot for another feed
- **THEN** the core marks the session unread, titles the other, refuses an archived conversation's late hook, marks the session read after the next snapshot, and refuses the hook credential's and the other feed's snapshots with `forbidden` without any read change

### Requirement: Codex Desktop collector

The runtime SHALL ship a host-local collector, `apps/runtime/bin/codex-desktop-collector.mjs` (Hub #567), which takes one owner-only private collector file naming a producer file and a Codex home, reads the home every 2 s (1 to 5 s configurable, so a snapshot always comes within the module's freshness window) with the module's own marker and metadata readers under a 5 s deadline, and publishes one `desktop-metadata` snapshot through `publishOnce` with the producer's edge, source and token whenever the snapshot's stamp changed and at least every 5 s. The producer file SHALL follow the existing producer and receipt contract, and its source SHALL be exactly `{provider: codex, client: desktop, hostId, sourceId, feed: desktop-metadata}`; anything else SHALL refuse the collector with exit 2 and one fixed line. Snapshots SHALL be bounded: over 4096 unread IDs, over 2048 archive IDs or a message over the byte budget SHALL give null for that input, never a truncated set, and titles SHALL keep the newest 512, fewer under the budget. The collector SHALL retry nothing, write no file, open no transcript, print nothing on stdout, and log on stderr only `time`, `level`, `event`, `bunny.code` and `trace_id`: each publication at DEBUG, the first failure or stall at WARN and then one summary a minute, and the recovery at INFO. SIGTERM or SIGINT SHALL end it with exit 0 within 1 s.

#### Scenario: Bounds and stamps
- **WHEN** a home holds 4097 unread IDs, 2049 archive names, 600 titles, or titles that take the message over the budget
- **THEN** the snapshot gives null unread, null archived, the newest 512 titles, or fewer titles and then null archived, and its stamp follows the bounded content, not the inputs' order

#### Scenario: Refused files
- **WHEN** the collector file is not private, has an extra member, names a producer whose source lacks the `feed` member or has `client: local`, or the producer is not enabled, qualified or receipted
- **THEN** the collector exits 2 with one fixed line and publishes nothing

#### Scenario: Against a real runtime
- **WHEN** the collector runs against a disposable runtime whose edge grants its derived credential, on a synthetic home that changes
- **THEN** its first snapshot, a heartbeat with the same stamp, and a new snapshot after the change reach a subscriber, stderr carries no path, ID, title or token, and SIGTERM ends it with exit 0
