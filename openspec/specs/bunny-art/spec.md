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
- **THEN** the target is `failed`, spend is its reported usage or zero, and nothing is resent

#### Scenario: The output is unusable
- **WHEN** output is invalid, missing or oversized
- **THEN** the target is `failed` before storage, spend is its reported usage, and otherwise the reservation is kept

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
- **WHEN** no fresh condition words exist
- **THEN** the prompt says nothing about weather

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

#### Scenario: Staging has not finished
- **WHEN** a composition is staged and no result has arrived
- **THEN** it is not a candidate

#### Scenario: Staging is uncertain or refused
- **WHEN** staging is refused or uncertain
- **THEN** it is not offered and not resent

#### Scenario: A favorite is reused
- **WHEN** the owner reuses a favorite
- **THEN** its saved bytes are staged again and no provider is called

### Requirement: The module publishes authenticated reads
The module SHALL serve one `art/2.0` state record with spent, reserved, uncertain and remaining amounts per provider, and SHALL offer `catalog`, `ledger`, `artwork.<id>` and `rendition.<id>` content references. The record SHALL carry no prompt, key, location or image bytes.

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
