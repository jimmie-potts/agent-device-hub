## MODIFIED Requirements

### Requirement: Pixoo device state and availability

The module SHALL publish `device` for its device, kind `pixoo`, with the Pixoo's capabilities (power, brightness, the Hub's modes `work`, `free` and `quiet` as its native modes, the seven media actions and at most 256 playlist and rendition IDs). It SHALL also publish its availability; the desired power, brightness and mode, the mode being the last Hub mode it was given; the observed power and brightness, only from the device's own probe; its pending commands and their families; its last outcome; its last transmission, for a command and for its own paints but never a probe; and its generation, a per-start epoch with the player's generation. It SHALL serve `device`, `pixoo-display`, `pixoo-rendition` and `pixoo-playlist` through sync, each record within the 256 KiB cap, at one stored revision that only rises, and SHALL publish only records that changed. `pixoo-display/2.1` SHALL report the mode and any pending mode in the Hub's vocabulary, the base on the display (`status` or `playback`), whether the status dashboard is drawn and current, what is showing, the status view, Now Playing, the player and the moments setting as `overStatus`. It SHALL report a moment as showing (`showing` `moment`, with the moment in `moments.playing`) only from the write the Pixoo acknowledged until the moment ends. Before that acknowledgment, and when the write fails or goes unanswered, `showing` SHALL report what the covered base shows: the dashboard over the status base, or `none` over a held item, and `moments.playing` SHALL be null. Its start SHALL NOT read the catalog: the module SHALL read it after the start, without reading any rendition's frames, and a sync naming `pixoo-rendition` or `pixoo-playlist` SHALL wait for that first read, which is served at the current revision without a publish. While no read of the catalog has succeeded, such a sync SHALL be refused with `unavailable` at once, and `device` and `pixoo-display` SHALL still be served. A failed read SHALL be tried again after a doubling wait from 1 s up to 30 s; a run of failures SHALL log one error, and the read that ends it one recovery. A multi-frame rendition's hosted check SHALL read its frames once per rendition and profile and be kept: at its import, before the import's outcome, or, for one the first read lists unchecked, after the start, one at a time, listed as its timing allows until then and published incompatible if its frames do not fit. A catalog change, a later start and a playlist start SHALL use the kept checks. It SHALL serve `device` beside every other device module, each for its own devices (#967), so a reader names `bunny/modules/pixoo` as the owner it syncs `device` from. Its start SHALL open only local resources and SHALL NOT wait on the device. It SHALL probe the device on the runtime's scheduler with a 2 s deadline: every 30 s while it answers, and after a doubling wait from 1 s while it does not. An unanswered probe SHALL make the device `unavailable`, never a module failure. A device that stays offline SHALL log one `device.unavailable` warning and DEBUG summaries, and its recovery one `device.available` record.

#### Scenario: Policy A in the module test kit
- **WHEN** the kit starts the module with a Pixoo that never answers
- **THEN** its start finishes within 1000 ms and the module then publishes the device `unavailable`

#### Scenario: Offline at start
- **WHEN** the module starts while its Pixoo refuses connections, stays so through several probes, then comes back
- **THEN** the module runs throughout, the device is `unavailable`, then `available`; one warning and one recovery that counts the failed probes are logged; and no device record repeats the one before it

#### Scenario: A large hosted library
- **WHEN** the module starts with 16 hosted multi-frame renditions and one whose colors do not fit, then edits a playlist, restarts and imports another clip
- **THEN** the start reads no frames and ends within 1.5 s, a reader's sync gets the catalog, each rendition's frames are read once after the start and the one that does not fit goes out incompatible, the edit and the restart read no frames, and the new clip's frames are read once, before its import's outcome

#### Scenario: A catalog that cannot be read
- **WHEN** the module starts while a stored manifest is corrupt, so every read of the catalog fails, and the manifest is then repaired
- **THEN** a sync of `pixoo-rendition` is refused with `unavailable` at once rather than at its deadline, `device` is still served, the failed reads are one record, and once a read succeeds the sync is served and the recovery is one record

#### Scenario: A rollback leaves what is served
- **WHEN** an outcome's transaction rolls back
- **THEN** no outcome goes out, a new copy syncs the record live followers last heard, still pending, and the command is not the last transmission; the next start reports it `uncertain` once

#### Scenario: The catalog within the cap
- **WHEN** a playlist holds 1,000 items, with the longest name and largest numbers
- **THEN** its record fits a 256 KiB message with room for the envelope

#### Scenario: Another module serves the device family
- **WHEN** another module serves `device` for its own devices before the Pixoo starts
- **THEN** the Pixoo starts with no ERROR record, a reader that names `bunny/modules/pixoo` syncs the Pixoo's device record alone, and a sync of `device` that names no owner is refused with `invalid-request`

#### Scenario: A moment in the display record
- **WHEN** a 1 s and a 3 s moment play over a playing item, and a moment's write over the status base goes unanswered
- **THEN** the record says `moment` and names the moment from its acknowledged frame until it ends and not after, though the moment's command still runs; the unanswered moment is never reported, and the record keeps `dashboard`

### Requirement: Pixoo commands, Hub mode and outcomes

The module SHALL answer, on `bunny.cmd.<family>.<device id>` only, `device-mode-set`, `media-start`, `media-control`, `brightness-set` and `power-set` (#918), and `pixoo-media-show`, `pixoo-monitor-set`, `pixoo-now-playing-set`, `pixoo-playlist-change`, `pixoo-asset-change` and `pixoo-notice-dismiss`. Before acting, it SHALL refuse with the shared error body:
- a command that breaks its schema;
- a stale `expectedConfigurationRevision` or `expectedGeneration`, with `revision-conflict`;
- a `requestId` it accepted before for other content, with `duplicate-conflict`;
- what the device's capabilities do not offer, with `unsupported-capability`, including a `device-mode-set` naming a mode other than `work`, `free` or `quiet`, and a playlist to start being offered when the library holds it, beyond the 256 the device record lists;
- a resume with nothing selected, with `invalid-state`;
- a `media-start`, `media-control` or `pixoo-media-show` that carries `requireMode`, with `invalid-request`, since the Pixoo takes no mode precondition from a caller;
- a `media-start`, `pixoo-media-show`, resume or restart-with-changes while the mode is Work, or while a `device-mode-set` is accepted and not completed, with `invalid-state`, checked in the admission queue so the check and a mode change cannot race;
- an unknown rendition or notice, with `not-found`.

Otherwise it SHALL store its record of the work in the transaction that publishes the device's new pending count, reply `accepted`, run the work outside the responder, and report the outcome through its outbox, committed with the device's new pending count, last outcome and last transmission; a change while a command runs SHALL wait up to 1 s for that commit, except a moment's picture the Pixoo acknowledged, whose change SHALL be published after the current turn, since the moment's command runs for the whole moment. A catalog command's outcome SHALL NOT wait on the read of the catalog after it: when that read fails, the outcome SHALL still go out, and the change SHALL go out once a later read succeeds. The outbox's `outcome.published` record SHALL be the outcome's only log record. What the module serves and its last transmission SHALL change only once a transaction commits, so a rollback leaves sync and live followers at the same records:
- A device write SHALL complete `succeeded` with `transmitted` once the Pixoo answers.
- A start, show, resume, next, previous or restart SHALL complete with its own first upload, found by the async context of the command's action.
- A failure the Pixoo answered SHALL have `transmitted` evidence, never `none`: an error status or code SHALL be `failed`, and an unreadable answer `uncertain` with `uncertain-result`. Like a confirmed send, it SHALL set the device record's `lastTransmission` with its request ID.
- Of the failures it did not answer, a write or upload that may have reached the device SHALL be `uncertain` with `uncertain-result` and no evidence.
- One that did not reach it SHALL be `failed`: `unavailable` for a device that did not answer or for a local failure before the first mutating send, which is no unreadable answer; `cancelled` for one a newer command superseded. A moment over the status base whose write failed locally before that send SHALL leave the status base current.
- A change to state the module owns (pause, stop, clear, the view and Now Playing settings, the moments setting, playlists, media and a dismissal) SHALL complete `succeeded` with `observed`, its committed state being the evidence; so SHALL a `device-mode-set` that writes nothing.
- While a song plays in Free or Quiet and Now Playing wants a `whole` takeover, a start, show, resume or restart SHALL pause for the card at once. One whose upload that pause cancelled SHALL complete `succeeded` with `observed`, the selection it committed being the evidence, and SHALL play once the takeover ends.
- A domain refusal after acceptance SHALL be `failed` with its registry code; any other failure after the work began SHALL be `uncertain`.

A repeated `(source, requestId)` with the same family, subject and data SHALL be accepted again and change nothing; with other content, it SHALL be refused with `duplicate-conflict`, for 24 hours after its completion and across restarts. A command accepted before a restart and never completed SHALL be reported `uncertain` with `uncertain-result` at the next start and SHALL NOT run again. A playback command that starts SHALL take the display from the status base, and a stop, pause or clear SHALL cancel a pending playback selection at once; a `device-mode-set` to Work SHALL cancel it the same way.

#### Scenario: A media start accepted, then completed
- **WHEN** media is imported, put in a playlist and the playlist started in Free
- **THEN** the start is accepted at once, completes `succeeded` with `transmitted` once the media reached the Pixoo, the Pixoo shows it as the playback base, and the device record names the start as its last transmission with nothing pending

#### Scenario: A start that carries requireMode
- **WHEN** a `media-start` arrives with any `requireMode`, or one arrives while a `device-mode-set` is accepted and not completed
- **THEN** the first is refused with `invalid-request` and the second with `invalid-state`, each with a `command.rejected` record, nothing reaches the device, the mode does not change, and the same start without `requireMode` once the mode change completed in Free is accepted with the unchanged reply

#### Scenario: Pause changes only the module's playback
- **WHEN** a playing playlist is paused
- **THEN** the pause completes `succeeded` with `observed`, the paused item stays as the playback base, and nothing more is sent to the device

#### Scenario: A pending playback selection cancelled
- **WHEN** a start waits on its capture over the status base, and a stop, pause, clear or `device-mode-set` to Work arrives
- **THEN** the start completes `failed` with `cancelled` and no evidence, the later command completes as its own outcome, nothing is selected and nothing was uploaded

#### Scenario: A start held back by a whole takeover
- **WHEN** Now Playing is `whole`, the Pixoo is in Free, a song plays, and a playlist is started
- **THEN** the start completes `succeeded` with `observed`, the takeover holds the card with the playlist selected and nothing of the playlist uploaded, and the playlist plays once the song stops

#### Scenario: A start superseded before a takeover
- **WHEN** a start's upload waits at the device, a `next` supersedes it, and a song then starts with Now Playing `whole`
- **THEN** the start completes `failed` with `cancelled`, and the `next` completes `observed` behind the card

#### Scenario: A write the Pixoo refused
- **WHEN** the Pixoo answers a brightness write with an error code
- **THEN** the command completes `failed` with `invalid-state` and `transmitted` evidence, because the write reached the device

#### Scenario: A write that may have reached the device
- **WHEN** a brightness write is sent and the device never answers
- **THEN** the command completes `uncertain` with `uncertain-result`, never as a refusal

#### Scenario: A restart before the outcome
- **WHEN** a brightness write is accepted on a silent Pixoo and the runtime restarts before it completes
- **THEN** the next start reports it `uncertain` with `uncertain-result`, and the device never receives the write

#### Scenario: Refusals before acting
- **WHEN** a mode change names a stale configuration revision, a mode the Pixoo does not offer such as `monitor`, or a power change a stale generation
- **THEN** each is refused with `revision-conflict`, `unsupported-capability` and `revision-conflict`, and nothing reaches the device

#### Scenario: A repeated request
- **WHEN** a brightness write is sent twice with one request ID
- **THEN** both are accepted, the device gets one write, and one outcome is published

#### Scenario: A request ID used again for other content
- **WHEN** a request ID the module accepted is sent again with other data, before and after a restart
- **THEN** it is refused with `duplicate-conflict`, nothing reaches the device, and the first request sent again is still accepted and changes nothing

#### Scenario: A playlist beyond the listed ones
- **WHEN** the library holds 257 playlists and the 257th is started, at once after the start and again once the device record lists 256
- **THEN** both starts are accepted and complete `succeeded` with `transmitted`, and a playlist the library does not hold is refused with `unsupported-capability`

#### Scenario: A catalog command whose read fails
- **WHEN** a playlist is created while every read of the catalog fails, and the catalog can then be read again
- **THEN** the creation completes `succeeded` with `observed` at once with nothing left pending, the failed reads are one record, and the playlist goes out once a read succeeds, with no other command
