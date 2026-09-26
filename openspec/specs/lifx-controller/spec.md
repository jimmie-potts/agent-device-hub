# LIFX controller

## Purpose

Provide bounded, configured-target LIFX LAN control with per-bulb outcomes and dated observations while preserving the shared controller contract.

## Requirements

### Requirement: Configured targets and qualified capabilities
The controller SHALL target only operator-configured unicast IPv4 bulbs, consume controller v1 for power and brightness, and expose color and temperature through a separately versioned strict LIFX profile. Unsupported or unknown features MUST fail before any packet is sent. No caller command SHALL contain an address or raw packet. Construction and source tests MUST NOT contact bulbs or discover devices.

#### Scenario: Qualified bulb
- **WHEN** vendor 1 product 27 firmware 2.90 is configured from qualification evidence
- **THEN** power, brightness, color and 1500–9000 K temperature are supported and effects remain unsupported

#### Scenario: Unsupported or malformed command
- **WHEN** a caller requests an unsupported feature or includes a destination or raw packet
- **THEN** the controller rejects it without traffic

### Requirement: One bounded queue per bulb
The controller SHALL serialize reads and writes for each configured bulb, preserve controller v1 request replay, revision and generation rules, and bound admission and retries. Partial color changes MUST preserve other observed HSBK components. Cancellation SHALL prevent queued writes and further retries, retaining possible effects of an already dispatched write.

#### Scenario: Overlapping writes and reads
- **WHEN** two commands and a read overlap for one bulb
- **THEN** their transport operations do not overlap and a brightness change preserves the color read in its queue turn

#### Scenario: Lost reply and timeout
- **WHEN** a reply is lost or a transport never settles
- **THEN** the attempt times out, only the configured bounded retries occur, and exhausted writes report uncertain possible effects while exhausted reads report failure

#### Scenario: Replay and cancellation
- **WHEN** an identical request is repeated or queued work is cancelled
- **THEN** replay causes no new transmission and cancelled work starts no later side effect

### Requirement: Independent results and observations
The controller SHALL return per-bulb results for a bounded multi-bulb submission without rolling back successful bulbs. Snapshots SHALL distinguish desired state, acknowledged transmission and observed state with a monotonic read time and age. Reads SHALL NOT issue Set messages. Acknowledgments MUST NOT imply visible change or refresh observation time.

#### Scenario: Partial multi-bulb failure
- **WHEN** one bulb acknowledges and another times out
- **THEN** both distinct results are retained and the successful bulb is not replayed

#### Scenario: Dated read
- **WHEN** a valid LightState reply is received and later a command is acknowledged
- **THEN** the observation retains its read time and gains age without claiming visible success

### Requirement: Source verification
The package SHALL participate in root build/type commands and required CI with fake transport tests covering the scenarios above and shared contract validation.

#### Scenario: Offline source checks
- **WHEN** the LIFX test suite runs
- **THEN** no native network socket or physical device is needed and malformed packet correlation is tested

### Requirement: Modes and automatic status painting

The package SHALL have no default mode-state directory. Modes exist only for a bulb whose owner configured `modeStateRoot`: a qualified bulb given one SHALL advertise `modes: {supported: true, values: ["Work", "Quiet", "Free"]}` and accept `mode.set`; a qualified bulb given none, and every unqualified bulb, SHALL advertise `modes: {supported: false}` and answer `mode.set` with `unsupported-capability`. The controller SHALL accept `mode.set` for a bulb with modes enabled without sending any bulb traffic: it SHALL persist the mode atomically under the configured root, keyed by the bulb's `deviceId`, and change the in-memory mode and `state.desired.mode` only after that write succeeds. A missing or invalid persisted mode file SHALL default to Free. A successful `mode.set` receipt SHALL report `outcome: "sent"` with `priorEffects: "confirmed-transmission"`, the only valid pairing in the shared receipt schema for a fully completed write. A persistence failure SHALL report `outcome: "failed"`, `priorEffects: "none"`, `failure.code: "transport-failure"`, and SHALL NOT change the mode, `desired.mode` or `serviceHealth`. A successful `mode.set` SHALL notify any registered mode-change listener.

Reading and writing the mode-state directory and its per-bulb files SHALL fail closed on any ownership or permission irregularity, matching this codebase's existing private-file/lease checks. The directory SHALL be created at `0700` if missing, and otherwise MUST already be a real directory owned by the current user with no group/world permission bits, or every read defaults to Free and every write fails. Reading a mode file SHALL open it `O_NOFOLLOW`, and MUST treat a symlink, a missing file, a file not owned by the current user, a file with any group/world permission bit, an oversized file or invalid JSON identically: default to Free. Writing a mode file SHALL create an exclusive (`O_CREAT|O_EXCL`), non-following temporary file at `0600` in the same directory, then rename it atomically into place; a failure at any step SHALL fail the request without leaving a partial or unsafe file in place.

The controller SHALL expose an internal absolute status paint operation, reachable only from within the package, that mints its own request identity from the bulb's current sequence, revision and generation, shares the bulb's queue and generation-cancellation rules, and appears in `lighting.pending` while queued. Its command kind MUST NOT be accepted by the public request parser or the `lifx-light` profile schema, so no external caller can submit it. It SHALL send exactly one zero-duration `LightSetColor` with full HSBK and MUST NOT issue a `LightGet` first or change power. It SHALL reject an unqualified bulb outright, with no traffic and no pending entry, as `unsupported-capability`. A paint that cannot be admitted, due to queue capacity, generation cancellation or an unqualified bulb, SHALL be a failed attempt that the controller does not retry.

The controller SHALL offer a graceful shutdown, distinct from `close()`/`cancel()`, that stops admission and retires every job still queued (each reports `cancelled` with `priorEffects: "none"` and sends no traffic) without aborting a job already in flight; that job SHALL settle on its own existing bound before the transport closes, and its receipt SHALL report its true outcome.

#### Scenario: Qualified bulb with a configured mode-state root declares modes
- **WHEN** a qualified bulb's snapshot is read and the controller was constructed with `modeStateRoot`
- **THEN** its capabilities include `modes: {supported: true, values: ["Work", "Quiet", "Free"]}`

#### Scenario: No configured mode-state root means no modes, even when qualified
- **WHEN** the controller was constructed without `modeStateRoot`
- **THEN** every bulb's capabilities include `modes: {supported: false}` regardless of qualification, and `mode.set` answers `unsupported-capability`

#### Scenario: Unqualified bulb declares no modes
- **WHEN** an unqualified bulb's snapshot is read
- **THEN** its capabilities include `modes: {supported: false}`

#### Scenario: mode.set persists without bulb traffic
- **WHEN** an admitted `mode.set` request is executed for a bulb with modes enabled
- **THEN** no packet is sent to the bulb, the mode file is written atomically, and the receipt reports `sent` with `confirmed-transmission` only after that write succeeds

#### Scenario: No recorded mode starts Free
- **WHEN** a bulb's mode file is missing or contains invalid JSON or an unrecognized mode
- **THEN** the bulb's mode and `state.desired.mode` are Free

#### Scenario: A symlinked mode file is never followed
- **WHEN** a bulb's mode file path is a symlink
- **THEN** the read is not followed and the bulb's mode defaults to Free

#### Scenario: An unsafe mode directory fails closed for both reads and writes
- **WHEN** the mode-state directory is group- or world-readable, or is not owned by the current user
- **THEN** a read defaults to Free and a `mode.set` write fails with `outcome: "failed"` and `failure.code: "transport-failure"`, sending no bulb traffic

#### Scenario: Persistence failure
- **WHEN** the mode file write fails
- **THEN** the receipt reports `failed` with `failure.code: "transport-failure"` and `priorEffects: "none"`, and the bulb's mode, `desired.mode` and `serviceHealth` are unchanged

#### Scenario: Internal paint shares the queue and is never externally reachable
- **WHEN** the internal paint operation is invoked for a qualified bulb
- **THEN** it appears in `lighting.pending` while queued, sends one absolute `LightSetColor` with no prior `LightGet`, never changes power, and no public request built from the same command kind is accepted by `submit()` or the `lifx-light` profile route

#### Scenario: An unqualified bulb never accepts the internal paint
- **WHEN** the internal paint operation is invoked for an unqualified bulb
- **THEN** it is rejected as `unsupported-capability` with no traffic and no pending entry

#### Scenario: A paint that loses a race is not retried
- **WHEN** the internal paint cannot be admitted because the bulb's queue is at capacity
- **THEN** the attempt fails without traffic and the controller does not retry it

#### Scenario: Graceful shutdown finishes an in-flight write and cancels the rest
- **WHEN** graceful shutdown is invoked while one write is in flight and further writes are queued behind it
- **THEN** the in-flight write completes and reports its true outcome, every queued write is cancelled with no further traffic, and the transport closes only once every write has settled
