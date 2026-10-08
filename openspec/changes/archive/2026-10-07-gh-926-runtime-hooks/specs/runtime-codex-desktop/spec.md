## ADDED Requirements

### Requirement: Codex Desktop configuration and the cutover's conversion

The runtime SHALL host one module, `codex-desktop` (module API 1.2), that turns Codex Desktop's read marker into read evidence for the core's sessions. Its `configure` SHALL accept a section with exactly the old Hub's `codexDesktop` members: `home`, an absolute, normalized path of at most 1024 characters without a NUL, which may lie on a Windows mount, and `hostId` and `sourceId`, each 1 to 128 letters, digits, underscores, dots or hyphens; the runtime's `secrets` member SHALL be ignored, and the module SHALL read no secret. A refusal SHALL be `invalid-request` with fixed text that repeats no value. `convertHubCodexDesktop(hostConfiguration)` SHALL turn the old Hub's host configuration into this section, give undefined when the Hub has no `codexDesktop`, and check the result with the module's own `configure`. The module's settings SHALL show `hostId` and `sourceId`, never the home. A runtime without the module's section SHALL refuse it with `not-found` and run on.

#### Scenario: Sections
- **WHEN** the section is the Hub's valid setting, on a Windows mount or not, with or without the runtime's `secrets` member, or adds a member, misses one, gives a relative or unnormalized home, a home with a NUL or over 1024 characters, or an ID with a space, empty or over 128 characters
- **THEN** the runtime admits the valid sections and refuses the others with `invalid-request`, whose detail repeats none of the values; without a section the module is refused with `not-found`

#### Scenario: The cutover's conversion
- **WHEN** the conversion reads a Hub configuration with a valid `codexDesktop`, one without it, and ones whose setting is malformed or carries `secrets`
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

Only `read-observed` lifecycle observations of Codex Desktop sessions SHALL reach the bus from the module, which SHALL send no command, and only the unread thread IDs SHALL leave the reader's process. The marker SHALL only be read. No message, record, setting or health entry SHALL carry the Codex home or the marker's content.

#### Scenario: Nothing carries the Codex home
- **WHEN** the module reads, publishes evidence, finds the marker unusable and its folder stalled, with a home on a Windows mount
- **THEN** every message it published is a Codex Desktop `read-observed` observation, it sent only its sync of the sessions, and no message, record or setting holds any part of the home's path

### Requirement: Simulated marker and acceptance tiers

The module SHALL come with `SimulatedMarker`, which lists unread threads, turns unusable, stalls every read until it answers again, fails a read, and reports its state, and its factory SHALL build the module with it under `--simulate`, with a simulated section whose home is never read. The catalog scenario `codex-desktop-read` SHALL run the module with the simulated marker in the in-memory harness on both transports and in disposable runs, where the supervisor holds the marker and the runtime's child reaches it over its IPC channel without a path. The module SHALL pass the module test kit.

#### Scenario: The catalog scenario
- **WHEN** `codex-desktop-read` runs in process, through the edge and in a disposable run: a Desktop turn and its subagent's end, the marker lists both, clears the flag, turns unusable while another turn ends, is written again, then the Codex home stalls while another turn ends and answers again
- **THEN** the top-level session reads unread, then read; the subagent stays unknown; the unusable marker gives no evidence for 8 s; the finished session reads read once it is usable; the stall logs one `device.unavailable` warning while the core still takes the new session and the module runs; and once the home answers one `device.available` record follows and the session reads read
