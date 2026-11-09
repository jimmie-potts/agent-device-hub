# bunny-pixoo-module Specification

## Purpose
Run the Pixoo as the B.U.N.N.Y. runtime module `pixoo` under ADR 0012 ([Hub #843](https://github.com/jimmie-potts/agent-device-hub/issues/843)): its configuration and the conversion of the Pixoo service's settings, the state it owns, its copies of the core's sessions and the playback record by sync, its commands with tracked outcomes, its device state under policy A, its isolated media jobs, consumer-only dismissal, and its code under the strict profile. It is source verified in disposable runs with a simulated Pixoo; installation and physical acceptance belong to the cutover (#840).

## Requirements

### Requirement: Pixoo module and its configuration

The Pixoo SHALL run in the runtime as the module `pixoo`, created by `createPixooModule({transport})` with module API 1.3, from the package `@jimmie-potts/pixoo` under `modules/pixoo`, which imports only the SDK, the contracts package, its own files, Node built-ins and third-party packages. Its manifest's `configure` SHALL accept a section with `device` (a routing ID, a private IPv4 address, a profile the transport accepts, and an optional label, model and firmware), `hostedGif` (bind, port and origin), the starting `presentation` and `nowPlaying` settings, `playback` (the playback record to follow) and an optional `quietBrightness` (an integer from 1 to 100, 20 when omitted), and SHALL name the device as the module's device. A presentation setting of version 1 MAY carry a `mode` member, which the module SHALL accept and ignore, since the Pixoo's mode comes from the Hub. It SHALL refuse any other section with `invalid-request` and fixed text that repeats no value. A real transport SHALL accept only the observed device profiles and SHALL need `hostedGif` for the hosted profile; a simulated one SHALL also accept the simulator's profile. The module SHALL read no secret. `convertPixooSettings` SHALL turn the Pixoo service's `device.json`, `hosted-gif.json`, `presentation.json` and `now-playing.json` into a section the module accepts, with the Hub's device ID `pixoo-local` unless told another, or a refusal.

#### Scenario: A valid section
- **WHEN** the runtime admits a section naming device `pixoo-1` at a private address with an observed profile
- **THEN** the module is accepted with `pixoo-1` as its device, and without a section it is refused with `not-found`

#### Scenario: Sections the module refuses
- **WHEN** a section has a device ID with a space, a public or malformed address, an unknown profile, an unknown member, a hosted origin that is not http, a presentation or Now Playing setting of another version, a `quietBrightness` outside 1 to 100, or a malformed playback ID, or names the hosted profile without `hostedGif` for a real device
- **THEN** each is refused with `invalid-request`, and no refusal repeats a value from the section

#### Scenario: The service's settings converted
- **WHEN** the conversion reads a version 1 device file with the hosted profile, the hosted listener's file and the presentation and Now Playing files
- **THEN** it returns a section with device `pixoo-local` that the module accepts and that names no secret, and a device file of another version, a hosted profile without the listener or a device ID that is not a routing ID gives a refusal

### Requirement: Pixoo state and copies

The module SHALL keep only state it owns, in its own SQLite file and private folder: the library's catalog and the player's checkpoint (through `Library.attach`), its revision counter, the status view, Now Playing and moments settings, its last Hub mode and remembered brightness, configuration revision and last outcome, the commands it accepted and has not completed, the commands it completed in the last 24 hours with a digest of each one's content, and each multi-frame rendition's hosted check by rendition and profile. It SHALL rebuild its copies of the core's `session/2.0` records and of the `playback/2.0` or `playback/2.1` record by sync and SHALL NOT store them. A copy that has not synced, or whose owner stopped serving, SHALL be tried again after a doubling wait. A copy that followed its owner and lost it SHALL log one warning. An owner that has not answered since the start SHALL log at DEBUG until the wait reaches its longest, then one warning, and its later arrival SHALL log one recovery.

#### Scenario: The library in the module's database
- **WHEN** the module starts on an empty state directory and imports media
- **THEN** the catalog's tables are in the module's SQLite file beside the outbox, the media files are in its private folder, and a restart finds them

#### Scenario: A playback owner that starts later
- **WHEN** no playback owner serves the record at the module's start, and one starts after the wait has grown to its longest
- **THEN** the early attempts log at DEBUG, one warning follows, one recovery is logged when the owner arrives, and the card follows its record

### Requirement: Monitor and Now Playing from synced records

The status dashboard (Monitor) SHALL draw the module's copy of the core's sessions, as divoom-app-upgrade's presentation drew its 1.x snapshot. It SHALL show one top-level session per page, attention first, its label or title or session ID, and its finished turns that the Pixoo has not acknowledged. It SHALL show the source as current, stale or unavailable from the copy's state. Now Playing SHALL draw the chosen playback record's track, from the configured record or else the first by ID. The card SHALL follow the record's `availability` and the copy's state, never the age of `observedAtMs`, since the owner publishes only changes: it SHALL be stale while the owner marks the record `stale` or the copy stops following its owner, and gone for an `unavailable` record or a player that is neither playing nor paused. A song that plays on unchanged SHALL keep a current card. The pop-up SHALL show over either base in every mode; a whole takeover SHALL hold the display only over the playback base in Free or Quiet, for as long as the song plays. Dashboards and cards SHALL render in worker calls; a failed render SHALL keep the last picture, SHALL be tried again, SHALL be logged once per run of failures, and SHALL be no evidence about the device. The dashboard SHALL render only while the status base is on the display, its layout staying current otherwise, and a changed card SHALL keep the pixels already on the device until a replacement is eligible and ready, without newly transmitting a previous observation.

Eligible ready artwork SHALL be decoded within the existing card worker under its declared PNG byte and dimension bounds and shown beside readable text in a static region. Stale cards SHALL dim image and text. Missing, unsupported, corrupt, animated or dimension-mismatched artwork SHALL produce the exact text fallback. Artwork and association tokens SHALL stay in private render context, outside the browser-facing playback view. Pending renders and queued card writes SHALL be rejected when their observation or presentation eligibility is superseded, including attention, stop, mode change, pop-up expiry and close. An internally superseded cancellation with no prior effects SHALL NOT suspend the status dashboard, end a current takeover, alter player or user-command outcomes, or report a device failure. A card upload for the same playback observation and unchanged playback view SHALL remain valid across artwork-only changes while its original presentation eligibility holds; once it settles, the latest eligible card SHALL use the existing serialized writer and cadence. Current failures and possible partial effects SHALL retain their existing uncertainty and recovery rules. Artwork arrival, disappearance or generation change alone SHALL neither trigger another track pop-up nor extend its deadline, pause the playlist again or reopen an expired pop-up. The module SHALL fetch no artwork and store no image bytes or playback history.

#### Scenario: Monitor follows the core's sessions
- **WHEN** the status base is on the display, and the core publishes a session that waits for approval, then one whose approval resolved
- **THEN** the Pixoo shows that session's dashboard, two frames pulsing, as rendered from the synced record, then one calm frame; the display record shows the status base with one matching session needing attention; and the paints are the device's last transmission with no request ID

#### Scenario: Now Playing pops up over Monitor
- **WHEN** the status base shows a session and the playback record starts a track
- **THEN** the Pixoo shows the track's card for ten seconds, the display record shows the card with no takeover, and the status dashboard returns

#### Scenario: A song that plays on unchanged
- **WHEN** the playback module's record keeps playing one song for more than 30 s without a change, first over the status base and then while a whole takeover holds the playback base in Free
- **THEN** the card stays bright through the ten-second pop-up, the display record shows it current, the whole takeover keeps it on the Pixoo for more than 30 s, and the playlist comes back once the song stops; the card turns stale only when the record does

#### Scenario: A failed render
- **WHEN** every render fails
- **THEN** nothing reaches the device, the device stays available, one warning reports the run of failures, and the module keeps running

#### Scenario: Artwork and exact fallback (Hub #285 AC1)
- **WHEN** eligible playing, paused and stale records carry a bounded ready PNG, long or missing text, or missing, unsupported or invalid artwork
- **THEN** independently checked 64x64 frames contain readable status and text beside the correctly sized image, stale image and text are dimmed, and every absent or refused image uses the existing text frame

#### Scenario: Same-text handoff while work waits (Hub #285 AC2)
- **WHEN** a Sony observation's card render or device write waits and a same-title Sonos observation or another Sony generation replaces it
- **THEN** no superseded image is newly transmitted beside current metadata, Sonos uses the text fallback, the current render alone can populate the cache, and no-effect internal cancellation preserves player and presentation state

#### Scenario: Artwork within the original pop-up (Hub #285 AC3)
- **WHEN** artwork arrives during a pop-up over either base, changes again after its original deadline, or finishes after attention supersedes it
- **THEN** it updates only an eligible current card, the original deadline and attention policy hold, and it neither extends nor reopens the pop-up; Now Playing off and whole retain their existing policies

#### Scenario: Artwork arrives during the native text-card upload (Hub #1054)
- **WHEN** the current observation's text fallback is already being uploaded and its artwork becomes ready without changing the playback view or presentation eligibility
- **THEN** the text upload finishes without an internal cancellation, the status base continues or the current takeover remains held, and the latest artwork card is subsequently uploaded through the same writer
- **AND** the original popup deadline remains unchanged, a replaced observation or playback view still cancels obsolete work, and a genuine native failure or possible partial effect retains its truthful outcome and recovery behavior

### Requirement: Pixoo device state and availability

The module SHALL publish `device` for its device, kind `pixoo`, with the Pixoo's capabilities (power, brightness, the Hub's modes `work`, `free` and `quiet` as its native modes, the seven media actions and at most 256 playlist and rendition IDs). It SHALL also publish its availability; the desired power, brightness and mode, the mode being the last Hub mode it was given; the observed power and brightness, only from the device's own probe; its pending commands and their families; its last outcome; its last transmission, for a command and for its own paints but never a probe; and its generation, a per-start epoch with the player's generation. It SHALL serve `device`, `pixoo-display`, `pixoo-rendition` and `pixoo-playlist` through sync, each record within the 256 KiB cap, at one stored revision that only rises, and SHALL publish only records that changed. `pixoo-display/2.1` SHALL report the mode and any pending mode in the Hub's vocabulary, the base on the display (`status` or `playback`), whether the status dashboard is drawn and current, what is showing, the status view, Now Playing, the player and the moments setting as `overStatus`. Its start SHALL NOT read the catalog: the module SHALL read it after the start, without reading any rendition's frames, and a sync naming `pixoo-rendition` or `pixoo-playlist` SHALL wait for that first read, which is served at the current revision without a publish. While no read of the catalog has succeeded, such a sync SHALL be refused with `unavailable` at once, and `device` and `pixoo-display` SHALL still be served. A failed read SHALL be tried again after a doubling wait from 1 s up to 30 s; a run of failures SHALL log one error, and the read that ends it one recovery. A multi-frame rendition's hosted check SHALL read its frames once per rendition and profile and be kept: at its import, before the import's outcome, or, for one the first read lists unchecked, after the start, one at a time, listed as its timing allows until then and published incompatible if its frames do not fit. A catalog change, a later start and a playlist start SHALL use the kept checks. It SHALL serve `device` beside every other device module, each for its own devices (#967), so a reader names `bunny/modules/pixoo` as the owner it syncs `device` from. Its start SHALL open only local resources and SHALL NOT wait on the device. It SHALL probe the device on the runtime's scheduler with a 2 s deadline: every 30 s while it answers, and after a doubling wait from 1 s while it does not. An unanswered probe SHALL make the device `unavailable`, never a module failure. A device that stays offline SHALL log one `device.unavailable` warning and DEBUG summaries, and its recovery one `device.available` record.

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

### Requirement: Isolated media jobs

Media decoding and rendering SHALL run in a forked child process with a 256 MiB heap, killed with SIGKILL when its job is aborted, so a corrupt, oversized or hostile image fails only its own job. Since the heap flag caps only V8's old space, the declared sizes SHALL bound the child's other memory: a GIF whose logical screen declares more than 4096 x 4096 pixels SHALL be refused from its header with `too-large`, before any decoding. An import SHALL take inline content of at most 160 KiB, or a file the uploader staged in the module's `incoming` folder, named by its SHA-256, whose size and hash must match. The module SHALL NOT write or remove `incoming` files: the uploader, #932's Pixoo pages, writes each one and removes it once the import's outcome arrives. An image that declares more pixels than the limit SHALL fail as `too-large` from its header, before decoding. A busy library lock SHALL be told by SQLite's code, never by an exception's message.

#### Scenario: A corrupt and an oversized image
- **WHEN** one import is not a valid PNG and another declares 20,000 by 20,000 pixels in a few bytes
- **THEN** the first completes `failed` with `invalid-request`, the second `failed` with `too-large`, the module keeps running and a valid import that follows succeeds

#### Scenario: A GIF that declares a huge canvas
- **WHEN** a 43-byte GIF declares a 7000 by 7000 logical screen, within the 50-megapixel source limit
- **THEN** it is refused as `pixel-limit` from its header, before any decoding, where its canvases took the child to 441 MiB before

#### Scenario: The child's heap
- **WHEN** the media child process is forked
- **THEN** its heap limit is capped near 256 MiB rather than the default

### Requirement: Consumer-only dismissal

`pixoo-notice-dismiss` SHALL acknowledge one finished turn's notice to the core with `notice-acknowledge` (#918), for the Pixoo's own consumer ID `pixoo`, so it clears on the Pixoo only. It SHALL refuse a notice its copy of the session does not hold with `not-found`. The core's acceptance SHALL complete it `succeeded` with `observed`, its refusal `failed` with the core's code, and no answer `uncertain`.

#### Scenario: A finished turn dismissed on the Pixoo
- **WHEN** the core holds a session with an unacknowledged finished turn and the Pixoo's dismissal is sent
- **THEN** the core receives `notice-acknowledge` from `bunny/modules/pixoo` for consumer `pixoo` and that notice, the dismissal completes `observed`, and a dismissal of an unknown notice is refused with `not-found`

### Requirement: Pixoo code under the strict profile

The Pixoo code SHALL pass the strict profile, the module boundary and the safe-error rules with no lint baseline and no staging, and its moved tests SHALL pass from the module's build, with the three cancellation cases restored against the module's command handling.

#### Scenario: Lint and tests
- **WHEN** `npm run lint:js` and `npm run test:pixoo:built` run after a build
- **THEN** lint reports nothing for `modules/pixoo`, which has no baseline entry, and every moved, restored and module test passes

### Requirement: Pixoo library and player pages in the shared dashboard
The Pixoo module SHALL contribute its existing library, playlist, player, preview, Monitor and settings views to the shared dashboard through the trusted frontend contract. Reads and commands SHALL use authenticated runtime interfaces and the existing Pixoo owner, preserving the base and Hub-mode semantics, consumer-only dismissal, revision checks and tracked outcomes. Catalog pages SHALL stay within 256 KiB and previews SHALL load by reference. Normal media addition SHALL use bounded authenticated staging and the existing import outcome cleanup; fresh state SHALL require no imported legacy media or playlists. Read-only callers SHALL have no mutation controls and SHALL be refused by the command boundary. Opening pages, reconnecting and reloading SHALL replay no media, effect or command.

#### Scenario: Explicit playlist edit through the real command path
- **WHEN** a control-authorized user opens a synthetic playlist, changes its draft name and explicitly saves it
- **THEN** opening and drafting leave the library and device unchanged, exactly one revision-checked tracked command is sent on save, and the resulting owner state confirms the name separately from acceptance or uncertainty

#### Scenario: Read-only editor and no replay
- **WHEN** a read-only user opens the editor and attempts a forged mutation, or a page reloads after a lost command reply
- **THEN** the mutation is refused without effects and no command is resent automatically

#### Scenario: Bounded catalog and referenced preview
- **WHEN** a library exceeds one 256 KiB catalog page and the user opens it and a preview
- **THEN** the catalog is split into bounded pages and the selected preview loads through its authenticated reference without exposing a private path

#### Scenario: Existing views remain usable
- **WHEN** the library, playlists, player, preview, Monitor and settings views are exercised with fresh synthetic media and a simulated Pixoo
- **THEN** their existing supported flows work through the runtime, keyboard and accessibility checks pass, and device effects occur only after explicit authorized commands

#### Scenario: Saved renditions and frozen player session
- **WHEN** the user renders a different preview, selects a saved playlist and explicitly starts it
- **THEN** existing originals and renditions remain, the Player page reads its frozen session and estimated timing through a bounded authenticated content reference, and later saved playlist edits wait for an explicit restart with changes

#### Scenario: Player reads are passive
- **WHEN** a caller reads the player content reference or opens the Player page
- **THEN** it receives existing state, session and sample time within 256 KiB, no query is accepted, and no playback or device command is sent

#### Scenario: Inspect settings and explicitly control the display
- **WHEN** a caller opens the Pixoo settings page
- **THEN** the page shows the safe configuration projection and current device facts without a device command
- **AND** configuration changes use the runtime configuration file and restart, while explicit brightness and screen controls use the existing tracked commands

#### Scenario: Monitor details follow their owner
- **WHEN** a session title, cached preview or player detail changes while the small display summary remains equal
- **THEN** the owner advances the existing display record revision so the page refreshes its referenced details without polling or a second connection
- **AND** Monitor reads only copied session facts and cached pixels; dismissal acknowledges only the Pixoo consumer through the existing command

#### Scenario: Ordinary upload and staging cleanup
- **WHEN** a user uploads synthetic media larger than the JSON command limit and the import completes, fails or its accepted request is repeated
- **THEN** one original import is tracked, no duplicate import is sent, and every terminal or definitively refused upload releases its private staged input without changing the display

#### Scenario: Abandoned upload after restart
- **WHEN** Pixoo restarts with an abandoned uploader-owned hash file
- **THEN** unfinished commands are reported uncertain, the temporary file is removed, and no import or display command is replayed

### Requirement: Private art staging

Pixoo SHALL accept supported `art-stage` minors only from the core and SHALL preserve the validated original and immutable 64×64 rendition in private transient storage. A stage SHALL have no display effect and SHALL NOT enter the permanent library. PNG stills and GIFs SHALL match their declared format, dimensions, frame count, duration and hash. Physical animations SHALL use one representable delay and the configured route’s command constraints. Decoding, bytes, queued work and live retained copies SHALL be bounded. A successful outcome SHALL mean the private copy committed, with observed evidence, and SHALL NOT claim physical output.

#### Scenario: A still and short animation are staged
- **WHEN** the core stages a valid PNG and a valid GIF
- **THEN** their originals are preserved, their immutable previews match the decoded 64×64 frames and effective timing, and no display command occurs
- **AND** the permanent catalog is unchanged

#### Scenario: Invalid or unauthorized staging
- **WHEN** a stage has a forged sender, bad signature or hash, false decoded metadata, excessive resources or unsupported timing
- **THEN** it is refused or completes failed without offering the copy and without a display command

#### Scenario: Duplicate and conflicting composition identities
- **WHEN** an unexpired composition is staged again with identical bytes
- **THEN** its immutable rendition is reused and its lifetime is renewed
- **WHEN** the same unexpired composition is staged with different bytes
- **THEN** it is refused with duplicate-conflict and the original copy is unchanged

#### Scenario: A retained copy is verified during renewal

- **WHEN** the request expires or the module stops while it verifies the retained bytes
- **THEN** the renewal fails and the previous copy keeps its expiry
- **WHEN** a matching renewal remains valid with a shorter requested lifetime
- **THEN** the existing longer lifetime is preserved

#### Scenario: Retention and restart preserve ownership
- **WHEN** a staged copy expires or staging fails and cleanup runs
- **THEN** unused transient copies are removed without removing any permanent library original or referenced rendition
- **AND** a copy held by an active moment or preview remains until that use ends
- **WHEN** the module restarts
- **THEN** committed unexpired copies remain usable, unfinished commands report uncertainty and no presentation replays

### Requirement: Exact-art moments

Pixoo SHALL declare `moments.art` when its configured profile admits the implemented art path. A core-forwarded `moment-play/2.1` with art SHALL resolve and retain that exact composition before admission, and SHALL refuse unknown or expired references before any effect. It SHALL never substitute mood art for an unusable exact reference. The existing one writer, moment time box, attention, manual-control and current-base restoration rules SHALL apply, with admission decided per base as the moment interludes requirement states. A moment without art SHALL keep its current behavior.

#### Scenario: Staged animation plays and returns
- **WHEN** a core art moment names a staged animation and the current base admits the moment
- **THEN** its exact frames and admitted timing reach the existing writer, then the current base returns
- **AND** expiry during that moment does not remove its copy

#### Scenario: Unavailable or forbidden exact art
- **WHEN** a caller other than the core requests an art moment, its reference is unknown or expired, or its profile cannot play it
- **THEN** no device write occurs and no mood fallback plays

#### Scenario: Existing admission wins
- **WHEN** attention, a Now Playing takeover, a paused item, Work without permission to cover status, or another existing moment gate refuses exact art
- **THEN** the current display intent is preserved with no queued replay

### Requirement: Exact Pixoo art can carry a deterministic forecast notice
The Pixoo SHALL advertise rain-notice support only with a renderer that shows a fixed readable forecast annotation beside exact saved art on 64×64. Notice-bearing moments SHALL require that capability, closed bounded data and evidence valid through the latest permitted start and intended hold, rechecked before a delayed first write. The annotation SHALL distinguish a forecast from an observation and chance from likely rain, preserve the exact staged composition identity and bytes, and use no free caller/provider text. The two bases and their admission rules, a paused item, attention, owner pins, Now Playing precedence, start-window checks and current-base restoration SHALL remain unchanged. A notice SHALL grant no mode change and no admission the base rules refuse.

#### Scenario: Forecast art in an eligible presentation
- **WHEN** an eligible Pixoo receives the default 10-second exact art moment and a rain notice valid through that hold
- **THEN** its native-size frames show the readable fixed annotation outside the fitted decorative image and its normal end returns to the base current at that time

#### Scenario: A factual appearance is unsupported or superseded
- **WHEN** notice support is absent, evidence becomes invalid before admission, or a paused item or manual takeover wins
- **THEN** the target reports refusal or its typed terminal outcome without silently stripping the label, changing mode or restoring an obsolete base

#### Scenario: The selected route cannot carry the labelled art
- **WHEN** the hosted route's 256-color GIF palette cannot hold the annotation beside an otherwise admissible exact original
- **THEN** the moment fails `unsupported-capability` with no transmission evidence, before any file is published or command sent
- **AND** the current base stays current, so the status base is not suspended by that refusal

#### Scenario: Transport consumes the forecast hold
- **WHEN** a slow upload or push consumes the remaining notice validity after effects begin
- **THEN** the existing owner caps its hold at source stale time or forecast end and reports an interrupted/cancelled attempt rather than completion of the full requested duration
- **AND** current-base restoration retains its own failed or uncertain evidence without resend or a claim that physical pixels cleared

### Requirement: Pixoo animation admission follows the selected command

The Pixoo SHALL preserve originals, immutable renditions and ordered frames with their delays for local preview. It SHALL bound input bytes, source and scaled decoded pixels, storage, worker time and queue capacity. Physical playback SHALL use the configured command route with uniform timing. Direct raw uploads SHALL admit at most 59 frames and refuse a larger count before a device write with a route-specific explanation. Whole-GIF playback SHALL admit 64×64 GIF renditions within the existing lossless encoding and resource budgets without imposing a frame-count ceiling. Existing named configurations SHALL retain their selected route, and existing renditions and playlist references SHALL remain readable under their original identities.

#### Scenario: Direct commands at the documented boundary

- **WHEN** a direct configuration receives uniform animations of 21, 59 and 60 frames
- **THEN** the first two reach its writer with every frame and offset, and the third is refused before a write with the direct route limit
- **AND** no hosted listener is required or selected

#### Scenario: A rain notice follows the route's limit

- **WHEN** a direct configuration plays a rain-labelled exact-art moment of 21 frames
- **THEN** every labelled frame reaches its writer and the moment reports its device evidence
- **AND** the label adds no frame ceiling beyond the selected route's own limit and the frame budget

#### Scenario: Long library and hosted animation

- **WHEN** an admitted animation contains more than a thousand frames
- **THEN** the catalog and preview include the final frame and its source timing, and a uniformly timed losslessly representable version reaches the explicitly configured hosted writer
- **AND** physical admission leaves the original and mixed-delay preview available

#### Scenario: Resource refusal and compatibility

- **WHEN** a small source canvas would expand past the decoded-pixel budget or an immutable manifest exceeds storage bounds
- **THEN** rendering reports the exhausted resource and preserves previously committed media
- **WHEN** an existing installation reopens old rendition and playlist references
- **THEN** their original identities and selected route remain readable

#### Scenario: A playback dwell exceeds one native timer interval

- **WHEN** physical playback holds one item for longer than the largest native timer interval
- **THEN** the player preserves its generation and dwell until the requested elapsed duration
- **AND** a pause or replacement cancels the remaining wait without advancing the superseded item

#### Scenario: Hosted bytes and filesystem capacity

- **WHEN** the losslessly encoded whole GIF exceeds the listener’s single-file budget
- **THEN** the library keeps its original and preview, reports incompatibility, and playing or staging it reports `too-large` before a write
- **AND** an art moment refused this way over the status base records no device evidence and leaves the status base current
- **WHEN** an admissible file cannot be stored because the filesystem or quota is full
- **THEN** the operation reports `capacity` and preserves previous media

### Requirement: Work set and Quiet brightness

The Pixoo SHALL take Work, Free and Quiet as its native modes, each set only by `device-mode-set`, and SHALL remember the last mode it was given across restarts, Free before any. A mode SHALL be policy only: it SHALL NOT select the content and SHALL NOT pause the player. In Work the module SHALL admit the status base, the Now Playing pop-up and moments or exact art whose request may cover status, and SHALL refuse a `media-start`, a `pixoo-media-show`, a resume and a restart-with-changes with `invalid-state` and a detail naming Work; a `device-mode-set` to Work while the player holds an active or paused item SHALL stop the player and return the status base, and nothing SHALL resume when Free returns. In Free the module SHALL admit everything it offers. In Quiet it SHALL admit what Free admits and SHALL write the configured Quiet brightness once on entry, remembering the brightness last requested before Quiet and writing that once on leaving Quiet; a `brightness-set` during Quiet SHALL be honoured and SHALL persist until the next `device-mode-set`, so a Quiet command received while already in Quiet reapplies the Quiet brightness, while a Work or Free command received in that same mode writes nothing. Work and Free SHALL write no brightness. Startup, restart and sync SHALL apply no mode and write nothing. A mode command that changes no pixels SHALL complete `succeeded` with `observed`; one that stops playback or writes brightness SHALL complete as that write under the module's existing outcome rules, with no retry, and an uncertain one SHALL leave the saved mode in place so the next mode command writes fresh.

#### Scenario: A mode is policy only
- **WHEN** the Hub fans out Free, then Quiet, then Work to a Pixoo showing the status base with nothing loaded
- **THEN** Free completes `succeeded` with `observed`, Quiet and Work complete as their brightness writes, the status base stays on the display, the player is never paused, and the display record reports each mode and the status base

#### Scenario: A start refused in Work
- **WHEN** a `media-start` arrives while the Pixoo is in Work
- **THEN** it is refused with `invalid-state` and a `command.rejected` record, nothing reaches the device, and the same start in Free is accepted and completes `succeeded` with `transmitted`

#### Scenario: Work stops playback
- **WHEN** a playlist plays in Free and Work is selected, then Free is selected again
- **THEN** the player stops and the status base returns, the mode command completes as that stop, the stopped item is retained, and nothing resumes on Free

#### Scenario: Quiet brightness and the remembered value
- **WHEN** brightness 100 is requested in Free, Quiet is selected with a Quiet brightness of 20, a `brightness-set` of 40 arrives, and Work is then selected
- **THEN** the Pixoo receives 20 on entering Quiet, 40 on the command and 100 on leaving Quiet, each as one write with its own outcome

#### Scenario: Nothing is applied at startup
- **WHEN** the module restarts after Quiet was selected
- **THEN** the device record reports Quiet, no brightness or player write occurs, and the next mode command writes fresh

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

Otherwise it SHALL store its record of the work in the transaction that publishes the device's new pending count, reply `accepted`, run the work outside the responder, and report the outcome through its outbox, committed with the device's new pending count, last outcome and last transmission; a change while a command runs SHALL wait up to 1 s for that commit. A catalog command's outcome SHALL NOT wait on the read of the catalog after it: when that read fails, the outcome SHALL still go out, and the change SHALL go out once a later read succeeds. The outbox's `outcome.published` record SHALL be the outcome's only log record. What the module serves and its last transmission SHALL change only once a transaction commits, so a rollback leaves sync and live followers at the same records:
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

### Requirement: Moment interludes over the two bases

The module SHALL declare `capabilities.moments` with the moods `celebrate`, `setback` and `reminder`, a 10 s maximum duration, and `coversStatus` following the owner's "moments over status" setting. It SHALL answer `moment-play` and `pixoo-moments-set` (data `overStatus`) on `bunny.cmd.<family>.<device id>`, the second completing `succeeded` with `observed`. The setting SHALL default to on and SHALL be saved with the module's other settings. A moment SHALL NOT change the device mode or the base.

Before accepting, the module SHALL refuse with `unsupported-capability` a mood or duration the capability does not offer; with `invalid-state` a moment ID it accepted in the last 24 hours, across restarts, a moment the current base does not admit, or a moment past its start window; and with `capacity` a moment while another waits or plays. A missed start SHALL be recorded as an owner refusal with no effect, with a detail explaining the missed window. The presentation SHALL check admission again at the start, and a moment no longer admitted SHALL complete `failed` with no device write.

Over the status base a moment SHALL be admitted only while the status dashboard is on the display, the setting is on, the session source is current and no session needs attention; in Work the request's `coversStatus` SHALL also be true, and in Free and Quiet it SHALL NOT be required. Over the playback base a moment SHALL be admitted only while the item plays, no Now Playing takeover holds the display and no session needs attention; a paused item SHALL refuse it, since nothing could repaint it. A pending mode change or a start still capturing SHALL refuse it on either base. No saved pause flag SHALL refuse a moment over the status base.

Over a playing item the moment SHALL pause the player through the Now Playing takeover and SHALL resume it only while the generation its own pause produced, the paused intent and the screen request are unchanged. No additional restore path SHALL exist. Over the status base the moment SHALL write under the status dashboard's generation and the next picture SHALL be the current dashboard.

A moment SHALL end when its duration has passed since its first acknowledged write. Attention SHALL end it at once on either base, and a session source that stops being current SHALL end it over the status base; either ending is `preempted`. An explicit command that changes what plays, a `device-mode-set` to Work, turning the setting off over the status base, or a view change over the status base SHALL end it as `interrupted`; a change to or from Quiet or Free SHALL NOT end it. A pause, stop or new start, including a start still capturing its selection, SHALL never be resumed over; a next or previous SHALL keep the playlist playing; a view change over the playback base SHALL resume the playlist. When a moment's picture was confirmed on the device and no dashboard, card or playlist follows, one blank frame SHALL replace it, never retried, and it SHALL be dropped after an uncertain write, or once the device was offline or under external control. A song that wants a whole takeover when the moment ends SHALL take the display with the player still paused.

A moment without art SHALL choose its mood picture from the request and draw it in a render worker before the player or the device is touched. A moment naming art SHALL use its retained validated rendition instead, preserving the staged frame timing. A failed render or content read SHALL complete `failed` and change nothing.

A moment that reached the device SHALL complete `succeeded` with `transmitted` and SHALL publish `moment-ended` in the same transaction as its outcome. One that never reached it SHALL have no ending: a failed or uncertain write SHALL complete as that write, the playback base SHALL come back unless the player paused itself on the uncertainty, and the status base SHALL stop as it does for a failed dashboard. A moment SHALL NOT be replayed after a restart: its command SHALL be reported `uncertain` at the next start.

#### Scenario: A moment over the status base returns to the current dashboard
- **WHEN** the status base shows a session in Work and a moment with `coversStatus` arrives, and the session changes while it plays
- **THEN** the moment shows for its duration with the status base still current, it completes `succeeded` with `transmitted` and a `completed` ending, and the Pixoo shows the changed session's dashboard

#### Scenario: Attention ends a moment over the status base
- **WHEN** a moment plays over the status base and a session starts waiting for approval, and the approval later resolves
- **THEN** the moment ends with `preempted`, the dashboard returns, and the moment does not play again

#### Scenario: A moment the status base does not admit
- **WHEN** the status base is on the display and a moment arrives with `coversStatus` false in Work, with the setting off, with a session needing attention, or with the session source stale
- **THEN** it is refused with `invalid-state` and nothing is written, and the same `coversStatus` false moment is admitted in Free

#### Scenario: A moment over a playing item resumes in place
- **WHEN** a playlist plays in Free and a flourish arrives
- **THEN** the player pauses, the moment shows with the mode unchanged, and the playlist resumes at the same item when it ends

#### Scenario: A moment over a paused item
- **WHEN** a playlist item is paused and a moment arrives
- **THEN** it is refused with `invalid-state` and nothing is written

#### Scenario: Exact art over the status base with nothing loaded
- **WHEN** the core sends exact art while the status base shows in Free and the player holds no item, after an earlier Hub mode change and a Clear
- **THEN** the art plays through the existing writer without pausing or starting playback, the dashboard returns when it ends, and no saved pause refuses it

#### Scenario: A view change while exact art waits or plays over the status base
- **WHEN** the owner changes the status view while exact art waits or plays over the status base
- **THEN** waiting art is cancelled without a write, or playing art ends as `interrupted` and the dashboard returns, and neither moment replays

#### Scenario: A manual command during a moment over playback
- **WHEN** a pause, stop or start arrives while a moment plays over the playback base
- **THEN** the moment ends with `interrupted`, the moment does not resume the player over that command, and after a pause or stop one blank frame replaces its picture

#### Scenario: Work arrives during a moment over playback
- **WHEN** Work is selected while a moment plays over the playback base
- **THEN** the moment ends with `interrupted`, the player stops without resuming, and the status base follows

#### Scenario: A song during a moment over playback
- **WHEN** Now Playing wants the whole display and a song starts during a moment over the playback base in Free
- **THEN** the card follows the moment with no upload of the playlist in between, and the playlist resumes when the song stops

#### Scenario: A failed write over playback
- **WHEN** the moment's write fails without reaching the device
- **THEN** the moment has no ending, its command completes as that write, and the playlist resumes

#### Scenario: A restart during a moment
- **WHEN** the module restarts with a moment accepted and unfinished
- **THEN** its command is reported `uncertain`, it does not play, and its moment ID stays refused
