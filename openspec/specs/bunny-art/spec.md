# bunny-art Specification

## Purpose
The art module generates art through API credits under spending limits per provider, and keeps a private catalog with favorites, feedback and references for the dashboard and the automation path.

## Requirements

### Requirement: Admission is durable and decides ownership by family
The art module SHALL commit one job row and a `succeeded`, `observed` outcome in one transaction before any provider call, and SHALL NOT re-run a job after a restart. Whether a job is the owner's or automatic SHALL follow the command family that admitted it, never its payload.

#### Scenario: A request is admitted
- **WHEN** `art-request` from the core carries a valid request
- **THEN** the row and its outcome commit together, the reply is `accepted`, and the art's result appears later in the `art` state

#### Scenario: An automatic request claims to be the owner's
- **WHEN** `art-auto` carries an owner label in its payload
- **THEN** the job is automatic and the daily pace and loop guard apply

#### Scenario: A save fails
- **WHEN** the row cannot be saved
- **THEN** the command is refused and no provider is called

### Requirement: Each provider has its own spending limits
The module SHALL keep one ledger in integer micro-dollars per host-local calendar month, with an editable monthly ceiling ($150 by default) and daily pace (about $5) for each provider. It SHALL bound and reserve every call's worst case from a price table in one transaction before sending it, and SHALL refuse a call with no table entry.

#### Scenario: Two requests race for the last room
- **WHEN** two concurrent requests have room for one reservation
- **THEN** one reserves and the other is refused before any call

#### Scenario: One provider reaches its ceiling
- **WHEN** a provider's next reservation would pass its ceiling
- **THEN** that provider's calls are refused and the other provider keeps working

#### Scenario: The daily pace is reached
- **WHEN** a provider's reservation would pass its daily pace
- **THEN** automatic work on that provider is refused, owner requests continue, and saved art still reads

#### Scenario: The loop guard is reached
- **WHEN** 30 automatic calls of either provider were dispatched in the last 60 minutes, whatever became of them
- **THEN** the next automatic call is refused and succeeds once the window has room, and owner requests are not limited

#### Scenario: A new month begins
- **WHEN** the host-local month changes
- **THEN** limits restart and earlier uncertain rows stay visible

### Requirement: A call settles from its reported usage and is never resent
The module SHALL settle each call from its response's reported usage. It SHALL keep the reservation as uncertain spend when the outcome is unknown, and SHALL send nothing again automatically.

#### Scenario: The outcome is unknown
- **WHEN** a call is cancelled or times out after dispatch, its response is lost, or a 5xx reports no usage
- **THEN** the target is `uncertain`, the reservation is kept, late bytes are discarded and nothing is resent

#### Scenario: The answer is a refusal
- **WHEN** a 4xx arrives for moderation, an unverified organization or a rate limit
- **THEN** the call fails, spend is its reported usage or zero, and nothing is resent; a display's non-moderation refusal may still produce the free local composition specified below, while a browser target or moderation refusal remains `failed`

#### Scenario: The output is unusable
- **WHEN** output is invalid, missing or oversized
- **THEN** the provider output is not admitted, spend is its reported usage or its reservation is kept without usage, and a display may produce the free local fallback specified below; an invalid browser result remains `failed`

#### Scenario: The runtime restarts with a call in flight
- **WHEN** the module starts and finds a dispatched call unsettled
- **THEN** the call is `uncertain` with its reservation kept, and a call that was reserved but never dispatched is released

#### Scenario: A settlement passes its reservation
- **WHEN** reported usage costs more than the reservation
- **THEN** the true cost is recorded, the excess is shown and logged as a fault, and later calls are refused at the ceiling

### Requirement: Each target succeeds or fails alone
A result SHALL be one artwork with one composition per target, whose immutable identity is the SHA-256 of the bytes that define it. A display composition SHALL have exactly one rendition.

#### Scenario: One target fails
- **WHEN** at least one target succeeded and another did not
- **THEN** the artwork is `partial` and the succeeded compositions are kept

#### Scenario: An idea call fails
- **WHEN** the optional idea call fails or is refused
- **THEN** its row stands on its own terms and the art continues from plain local words

#### Scenario: A provider cannot draw
- **WHEN** the image provider is absent or lacks image output
- **THEN** the target is refused before any call

### Requirement: Display art is a reduced provider GIF with a free fallback
The module SHALL request one eight-frame GIF per display from OpenAI's GIF output on the generation endpoint. It SHALL decode the result under bounded limits, check its size, frame count and timing inside Pixoo's observed envelope, reduce each frame with Lanczos to 64×64 or 64×32, and rebuild one GIF with at most 32 colors. A wrong or undecodable GIF SHALL still count as spent. It, a preview-access refusal or another definite failure SHALL fall back to free local motion with no further call. A moderation refusal SHALL stand, and an unknown outcome SHALL stay uncertain. The browser composition SHALL be its own still.

#### Scenario: A GIF passes
- **WHEN** the returned GIF has the requested size and frame count and timing inside the envelope
- **THEN** the composition's identity is the returned GIF's hash and its one rendition is the reduced GIF

#### Scenario: A GIF is wrong
- **WHEN** the returned GIF fails those checks or cannot be decoded
- **THEN** its usage is settled, or its reservation kept without usage, the composition is local motion, no second call goes out and the state's rejected count rises

#### Scenario: The GIF preview is refused
- **WHEN** the provider refuses access to the GIF preview
- **THEN** the target succeeds with local motion from the artwork's browser still or procedural art, names why, and nothing is resent

### Requirement: Prompt context is limited
Prompts SHALL hold only the owner's typed text, imagination, time, season and weather condition words, within 4,000 characters. Art SHALL be marked as not factual, and prompts, responses and keys SHALL stay out of state and logs.

#### Scenario: Weather is stale or missing
- **WHEN** observed weather is unavailable or past its freshness bound at provider dispatch, including after a job waits in the queue
- **THEN** the prompt says nothing about weather

#### Scenario: The request supplies weather inspiration
- **WHEN** the request explicitly supplies condition words in its validated context
- **THEN** the prompt preserves them as requested inspiration, without claiming they describe current observed conditions

#### Scenario: A variation has a long source idea
- **WHEN** the source idea reaches its bound and the owner supplies an explicit change
- **THEN** the complete bounded change survives in the image prompt, with source context fitted inside the total prompt limit

#### Scenario: A request carries another field
- **WHEN** a request carries a field outside its declared set, such as a location
- **THEN** it is refused before a row exists

### Requirement: The catalog retains what the owner keeps
The module SHALL prune only unsaved, unreferenced art past a configured recent limit, keep favorites until they are deleted, and store explicit feedback only. Deletion SHALL remove art from selection at once and its bytes when nothing can still refer to them, and SHALL report retained copies.

#### Scenario: Recent art passes the limit
- **WHEN** art beyond the limit is neither a favorite nor referenced by a staged copy
- **THEN** it is pruned, while favorites and referenced art stay

#### Scenario: Art a device holds is deleted
- **WHEN** the owner deletes art with a live staged copy
- **THEN** it leaves selection, the state reports the retained copy, and the bytes go after the copy's lifetime ends

#### Scenario: The owner gives no feedback
- **WHEN** a piece is ignored
- **THEN** nothing is written, and its place in selection does not change

### Requirement: Saved art is offered only after a device confirms it
The module SHALL send staged compositions through `art-dispatch` and SHALL offer a candidate only after the core reports that staging succeeded. It SHALL NOT start a takeover. Reusing saved art SHALL spend nothing.

#### Scenario: A display uses its configured device identity
- **WHEN** a display kind has exactly one matching device in its designated owner's current SDK copy and declares the required art capability
- **THEN** staging and ambient commands address that device's ID, while art state retains the display kind
- **AND** physical connectivity remains the device owner's admission decision; local staging does not require the panel to be online

#### Scenario: Device identity is not established
- **WHEN** the owner's device copy is absent, replacing, failed or removed, matching identities are ambiguous, or the required art capability is missing
- **THEN** no command is forwarded to a guessed device ID

#### Scenario: Staging has not finished
- **WHEN** a composition is staged and no result has arrived
- **THEN** it is not a candidate

#### Scenario: Staging is uncertain or refused
- **WHEN** staging is refused or uncertain
- **THEN** it is not offered and not resent

#### Scenario: Staging evidence becomes conflicting
- **WHEN** a successful stage later becomes uncertain because its outcomes conflict
- **THEN** its candidate is withdrawn and no new stage is sent automatically

#### Scenario: A receipt arrives late
- **WHEN** a stage result arrives after the copy's conservatively recorded expiry
- **THEN** the candidate stays unavailable; the receipt does not grant a new lifetime

#### Scenario: Ambient selection changes during staging or renewal
- **WHEN** the owner deletes the selected artwork or a later ambient selection supersedes it
- **THEN** the old result and queued renewal cannot select that artwork again, including after restart
- **AND** deleting the last issued tile artwork clears it even when a renewal or replacement stage is pending; pending staging does not erase the durable record of the issued tile selection
- **AND** evidence about an old stage cannot clear a newer issued stage of the same artwork, and a definitive replacement refusal preserves the preceding issued selection without overwriting any newer command
- **AND** ambient admissions are serialized, each selection is rechecked before dispatch, and stop discards unsent commands without replay on restart

#### Scenario: A favorite is reused
- **WHEN** the owner reuses a favorite
- **THEN** its saved bytes are staged again and no provider is called

### Requirement: The module publishes authenticated reads
The module SHALL serve one `art/2.1` state record with spent, reserved, uncertain and remaining amounts per provider and the selected browser composition reference, and SHALL offer `catalog`, `ledger`, `artwork.<id>` and `rendition.<id>` content references. Consumers SHALL retain support for `art/2.0` records. The record SHALL carry no prompt, key, location or image bytes.

#### Scenario: A dashboard syncs
- **WHEN** a reader syncs `art`
- **THEN** it receives the complete record and follows its replacements

### Requirement: Art commands reach the module only from the core
The module SHALL refuse `art-request`, `art-auto` and `art-catalog-edit` from any source but the core before reading them. Starting and cancelling jobs SHALL use `v2/art`'s families, and favorites, feedback, deletion and reuse SHALL use `art-catalog-edit`, which the tracker admits only from the dashboard.

#### Scenario: Another sender reaches the responder
- **WHEN** a participant other than the core sends one of these commands
- **THEN** the reply is `forbidden` and nothing is admitted

### Requirement: Weather reaches prompts as fresh condition words
The module SHALL read `weather-state` by sync, and SHALL pass only fresh lowercase condition words to a prompt. A temperature, a day part or any other field SHALL NOT reach a prompt, state or log.

#### Scenario: A record names a temperature
- **WHEN** a fresh record's words are `chance of rain`, `48°F` and `evening`
- **THEN** the prompt's weather is `chance of rain`

### Requirement: Authenticated art gallery and explicit owner actions
The browser SHALL show the shared private catalog through authenticated bounded reads and live art state. It SHALL offer recent art, favorites, explicit more/less/dismiss feedback, requests and variations. A request SHALL identify its selected targets, defaulting to UI, Tidbyt and Pixoo in one owner request. A variation SHALL retain its source artwork identity. Browsing, resizing and revisiting saved art SHALL read an existing browser composition without a provider call or device command. Silence SHALL NOT become feedback. Read-only or stale controls SHALL refuse mutation.

#### Scenario: Revisit a favorite
- **WHEN** the owner opens a saved favorite from a later gallery page
- **THEN** its existing rich browser composition and provenance appear with no generation, staging or device command

#### Scenario: Request admission and generation differ
- **WHEN** a request is durably admitted but its generation is still queued or running
- **THEN** the browser reports that progress separately from command admission, and later shows the job's succeeded, partial, failed, rejected, cancelled or uncertain result

#### Scenario: Spend is exhausted or uncertain
- **WHEN** a provider reaches its limit or loses a response
- **THEN** the browser shows that provider's remaining, reserved and uncertain amounts and the job's stated reason, preserves existing art and sends no automatic retry

### Requirement: Complete rich browser art before presentation
The browser SHALL use the artwork's rich UI rendition, preserve its proportions and identify it as generated art with its supplied provenance. It SHALL validate content metadata and finish decoding all required image data before replacing the current presentation or reporting completion. Missing, malformed, refused or failed content SHALL produce an explicit unavailable state. Disconnect or incomplete sync SHALL preserve readable prior evidence marked stale. Reduced motion SHALL have a still presentation, and obsolete image loads SHALL NOT replace newer choices.

#### Scenario: A late response loses its selection
- **WHEN** the owner selects B while A is still loading and A finishes last
- **THEN** only the current successfully decoded selection can replace the visible art and obsolete resources are released

#### Scenario: New content cannot load
- **WHEN** required image data is incomplete, malformed, unavailable or undecodable
- **THEN** the browser does not report it complete or update its presented palette, and shows the failure while preserving any previous readable presentation

### Requirement: Local art decoration follows actual presentation
Local dashboard decoration SHALL use only a validated bounded palette from fresh decoded visibly presented artwork. Applying, locking or restoring decoration SHALL perform no generation call, device command, catalog edit or layout save. Invalid palette or styling input, missing assets, stale observations and unfinished or obsolete image loads SHALL keep the valid prior or default decoration.

#### Scenario: A new image is not ready
- **WHEN** selected artwork is loading, fails decoding, becomes stale or is replaced by a newer selection
- **THEN** its unpresented palette does not change decoration and the prior valid or default theme remains usable

#### Scenario: Styling input is malformed
- **WHEN** a palette or stored styling preference contains invalid colors, unknown fields, a texture URL, a private path or executable content
- **THEN** no supplied code or asset is used and the valid prior or default theme is retained

#### Scenario: Local application is free
- **WHEN** valid displayed art changes decoration or the owner locks or restores colors
- **THEN** provider-call and device-command counts do not increase and Home layout remains unchanged

### Requirement: Saved composition preparation has a completed staging outcome
The Art owner SHALL accept a core-only request to prepare one existing display composition without a provider call or display effect. Admission SHALL remain distinct from its final tracked outcome. Success SHALL mean the target owner confirmed staging that exact composition. Missing or deleted art, a missing rendition, absent current capability, refusal and uncertainty SHALL remain distinguishable. A duplicate request SHALL NOT stage again, and restart SHALL NOT resend pending preparation.

#### Scenario: A target admits staging but has not completed it
- **WHEN** the display admits the stage command and has not yet reported its outcome
- **THEN** the preparation remains pending rather than claiming success
- **AND** other targets can prepare and complete independently

#### Scenario: Preparation loses its response or restarts
- **WHEN** a preparation loses its final evidence or the Art owner restarts with it pending
- **THEN** the retained operation records uncertainty without a provider call, automatic resend or display effect

### Requirement: Browser selection belongs to the private Art catalog
The core SHALL select an existing successful browser composition through the Art owner. The selection SHALL be committed with its tracked outcome and published as versioned Art state. Success SHALL mean selection committed, never browser pixels displayed. The selected reference SHALL survive restart and catalog pruning. Explicit deletion SHALL clear that reference in the same transaction. A refused selection SHALL preserve the previous choice. Existing 2.0 commands and schema definitions SHALL retain their behavior.

#### Scenario: An older selected artwork leaves the recent page
- **WHEN** the selected artwork is older than the recent catalog limit and newer artworks arrive
- **THEN** its browser composition remains readable and selected without another provider call

#### Scenario: The selected artwork is deleted
- **WHEN** an explicit owner deletion succeeds for the selected artwork
- **THEN** the selection is cleared atomically and consumers receive the updated state

### Requirement: Scheduled generation does not select a presentation
The Art owner SHALL use its existing automatic start with appearance purpose for generation-only preparation that retains existing automatic accounting and job outcomes while granting no ambient or takeover effect. Explicit automatic weather-use omission SHALL perform no job weather read and add no weather prompt context; permitted weather use SHALL remain limited to fresh condition words rechecked before each paid call. Existing owner request semantics and older command payloads SHALL remain unchanged.

#### Scenario: The scheduler omits weather
- **WHEN** a generation-only automatic request explicitly omits weather
- **THEN** the job reads no weather context, the prompt carries none, and completion only makes the saved compositions available
- **AND** no ambient choice, browser choice or moment follows merely because the job completed

#### Scenario: A provider is paused
- **WHEN** a monthly ceiling, daily pace, loop guard, missing key or uncertain previous call prevents new paid work
- **THEN** accounting remains authoritative, no request is retried, and saved compositions remain available to free preparation and selection

### Requirement: Free saved ambient selection preserves current authority
The Art owner SHALL accept a core-only, closed command for one exact saved Tidbyt composition and configured target. It SHALL prepare the saved bytes without a provider call, then request a final core policy check immediately before the ambient handoff. A revoked, expired, mismatched, consumed or restart-lost authorization SHALL cause no new tile selection. Pending, revoked or definitely refused selections SHALL NOT replace the preceding durable renewable intent. Accepted or uncertain issued intent SHALL retain the existing local renewal lifecycle for its exact composition and configured target across schedule disable and restart, without reusing the initial grant, retrying its selection attempt, taking over a display or changing its mode. Explicit deletion and later admitted replacement SHALL retain their existing behavior; schedule disable SHALL NOT automatically clear an issued tile. Completion evidence SHALL distinguish staging, issued selection, uncertainty and physical visibility.

#### Scenario: Reuse while generation is unavailable
- **WHEN** an eligible authorized ambient update selects saved art while paid generation is unavailable
- **THEN** its exact saved bytes are staged and selected without a provider call, a mode write or a moment

#### Scenario: Permission is revoked while staging waits
- **WHEN** the ambient composition stages successfully after its opportunity is revoked or expires
- **THEN** the final handoff is refused, the preceding issued tile intent remains intact and no later callback or restart replays the rejected selection

#### Scenario: Disable and restart preserve an issued ambient tile
- **WHEN** A is issued for one exact composition and configured target, the schedule is disabled, and its renewal time passes before and after restart
- **THEN** A retains its existing local renewal lifecycle for that same composition and target without consuming a new opportunity or reusing its initial grant
- **AND** no automatic clear, provider call or retry of the selection attempt occurs, and an uncertain issued result remains uncertain

#### Scenario: A refused replacement never becomes renewable
- **WHEN** A is the renewable issued intent, replacement B stages but its opportunity is revoked or its final handoff is definitely refused, and renewal time or restart follows
- **THEN** A remains the renewable intent and no renewal, late callback or restart selects B
- **AND** B's unused or consumed grant cannot authorize another attempt or target

### Requirement: Factual treatment never changes saved art identity
A factual notice SHALL be a separate deterministic presentation annotation and SHALL NOT modify original or staged image bytes under their existing composition identity, change generated provenance to factual, or enter provider prompts. Catalog and selection semantics SHALL remain owned by Art; a schedule's current notice SHALL NOT create a second authoritative catalog.

#### Scenario: A saved fictional scene accompanies a forecast
- **WHEN** a previously generated scene is reused with a fresh rain forecast notice
- **THEN** its composition ID and bytes remain unchanged, its provenance remains factual false, and the notice's source and meaning are separately inspectable

### Requirement: Additive rain and ambient schemas retain old consumers
The implementation SHALL keep existing closed art, moment and device schema versions unchanged. New rain notices and explicit automatic weather use/free ambient selection SHALL use closed minor versions of their owning families. Plain exact-art plans SHALL retain their existing wire shape. Notice-bearing dispatch SHALL require an exact art reference, core-only admission and the target's declared rain capability, and SHALL bind the full notice into the shared plan's immutable identity. There SHALL be no arbitrary fact text, generic notice ingestion or retained controller 1.x change.

#### Scenario: Old and new consumers coexist
- **WHEN** one configured target declares exact-art support without rain notices and another declares the new notice capability
- **THEN** ordinary art remains compatible with both, while a factual appearance is sent only to the target declaring its notice and version support
- **AND** no newer field is sent under an older schema or silently removed to claim factual delivery

#### Scenario: The notice changes under a previously claimed plan ID
- **WHEN** a caller changes the weather revision, likelihood, interval or other notice fact while reusing an admitted plan ID, including after restart
- **THEN** the shared presentation path refuses duplicate-conflict before any new phase instead of relabelling an old attempt
