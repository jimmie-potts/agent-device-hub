## MODIFIED Requirements

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

### Requirement: What leaves the Codex Desktop module

Only `read-observed` and `metadata-observed` lifecycle observations of Codex Desktop sessions SHALL reach the bus from the module, which SHALL send no command, and only the unread thread IDs, the archive filename IDs and validated titles SHALL leave the reader's process. The marker SHALL only be read. No message, record, setting or health entry SHALL carry a Codex home or the marker's content. For a remote source the module SHALL subscribe to `bunny.event.desktop-metadata.*` and sync the core's sessions, and nothing else.

#### Scenario: Nothing carries the Codex home
- **WHEN** the module reads, publishes evidence, finds the marker unusable and its folder stalled, with a home on a Windows mount
- **THEN** every message it published is a Codex Desktop lifecycle observation, it sent only its sync of the sessions, and no message, record or setting holds any part of the home's path

## ADDED Requirements

### Requirement: Remote Desktop sources

For a source without a `home` the module SHALL take `desktop-metadata` snapshots (see the shared event contract) as that source's reads, under the same read, settle, archive-expiry, title and resend rules as a local source (Hub #567). It SHALL take a snapshot only when its envelope source is a remote part (`bunny/parts/...`), its subject is the configured feed's ID and its feed is that source with `client: desktop`; any other snapshot on those keys SHALL change nothing and SHALL be logged once per sender and key, `forbidden` at WARN or `not-found` at INFO for a feed the module does not follow. A read SHALL answer from the latest snapshot received less than 10 s ago, as `unchanged` when its stamp is the one the module holds; without a fresh snapshot a read SHALL wait for the next one, so the existing 5 s deadline makes the marker unavailable, logged once, with archive positives cleared, and the next snapshot SHALL answer the waiting read at once and log the recovery. A snapshot whose `observedAtMs` is not newer than the last one taken for its feed SHALL be ignored, noted at DEBUG, and SHALL neither renew the feed's freshness nor reorder evidence; the settle rule SHALL measure from the receipt of the snapshot a read answers from, never from a later poll. Each source SHALL have its own marker device in records, `marker` alone when one source is configured and `marker:<hostId>:<sourceId>` otherwise, and every observation SHALL carry its own source's identity, so the same thread ID on two sources is two sessions. The module SHALL read no local file for a remote source.

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
