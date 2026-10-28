## ADDED Requirements

### Requirement: Explicit browser speech availability
Speech SHALL default to off. Enabling text companions SHALL NOT enable speech. An authorized operator SHALL explicitly select one qualified browser endpoint and declare availability for its current connection. The UI SHALL explain that calls and other applications are not detected and that the operator must mute before interruption-sensitive activity. Quiet, category mute, stale or cleared attention, missing live state and unavailable output SHALL prevent new unsolicited speech. Work and Free SHALL permit a fresh eligible coding question after explicit enablement.

#### Scenario: Independent enablement
- **WHEN** text companions are enabled but speech has not been enabled on the current connection
- **THEN** eligible coding attention remains visible and produces zero audio

#### Scenario: Current question with permission
- **WHEN** the selected endpoint receives a fresh coding question in Work or Free with live evidence, enabled text and speech, manual availability and an unmuted category
- **THEN** it can speak the existing fixed phrase once after a final policy check
- **AND** Quiet, mute or cleared attention before playback suppresses the output

#### Scenario: Availability ends with the endpoint
- **WHEN** the selected endpoint reloads, disconnects, is lost, unmounts or observes runtime restart
- **THEN** its availability is invalidated and any local speech is cancelled
- **AND** reconnect requires explicit enablement, admits only new opportunities and never selects another tab

### Requirement: Qualified local voice and bounded playback
Missing installation qualification, an unavailable browser identity or a different Chrome version or platform SHALL leave speech unavailable while preserving text companions. Each enable action SHALL re-enumerate voices with a five-second bound and require an exact qualified local English voice. The driver SHALL select that voice explicitly on each utterance without changing defaults or falling back to a default, remote or changed voice. It SHALL perform no microphone, recording, cloud synthesis or automatic retry. Playback SHALL have a finite deadline and SHALL report completion only after an ordered start and end callback. Callback completion SHALL NOT mean heard.

#### Scenario: Browser qualification unavailable
- **WHEN** the installation has no valid private qualification receipt or the page cannot match its qualified Chrome version on macOS
- **THEN** speech remains unavailable without disabling text companions or selecting a replacement route

#### Scenario: Voice unavailable
- **WHEN** the qualified voice is absent, changed or not local after the bounded enumeration
- **THEN** speech remains unavailable and zero utterances are submitted

#### Scenario: Ambiguous output
- **WHEN** an end arrives without a start, callbacks are lost, a deadline passes or the endpoint connection is lost after submission
- **THEN** the operation remains uncertain and no utterance is replayed

#### Scenario: Stop and mute
- **WHEN** the operator stops or mutes active speech
- **THEN** local cancellation runs immediately, pending speech is discarded and the UI distinguishes a confirmed stopped state from uncertain cancellation
- **AND** partial playback remains recorded and stopping does not cancel a coding task or grant permission

### Requirement: Single speech coordinator
The companions owner SHALL reserve one browser endpoint, admit at most one active and one current pending announcement, and reuse its existing opportunity, deduplication, admission and fixed-text rules. Actionable coding attention SHALL take priority over social speech. Replacement SHALL wait for confirmed cancellation and SHALL recheck current policy after every asynchronous wait and immediately before submission. Uncertain output SHALL prevent automatic replacement. Speech suppression SHALL NOT suppress ordinary visual coding attention. Existing synthetic scenario controls SHALL produce zero audio.

#### Scenario: Competing candidates and tabs
- **WHEN** two tabs enable speech or duplicate and competing opportunities arrive
- **THEN** one reserved endpoint receives at most one active command and one current pending candidate
- **AND** a second tab cannot take over and duplicate opportunities cannot speak again

#### Scenario: Separate social allowance
- **WHEN** a social candidate is blocked by its Free-only, busy, media, snooze, daily or spacing policy
- **THEN** it cannot consume coding admission or hide visual coding attention
- **AND** manual coding availability does not qualify unknown social inputs or make scenario fixtures audible

#### Scenario: Durable result without replay
- **WHEN** an accepted speech operation restarts before its receipt is committed
- **THEN** the owner reports uncertainty through its existing outcome path without restoring availability or executing the utterance again
