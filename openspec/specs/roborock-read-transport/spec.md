# roborock-read-transport Specification

## Purpose

Provide the Roborock module with a bounded read-only connection and explicit private account setup, without exposing vacuum controls or claiming installed compatibility from source tests.

## Requirements

### Requirement: Only explicit read operations reach the target

The transport SHALL expose status, consumables, cleaning summary, one cleaning record, room mapping and current-map bytes. Its final send boundary MUST allow only `get_status`, `get_consumable`, `get_clean_summary`, `get_clean_record`, `get_room_mapping` and `get_map_v1`, with fixed operation-specific parameters. It MUST NOT expose a generic RPC to consumers, discover targets, change maps, retrieve photos or command cleaning. Construction, import and simulation SHALL perform no network operation. (Hub #1070 AC1-3.)

#### Scenario: Each approved read uses its qualified route

- **WHEN** a caller explicitly reads each supported operation for the configured target
- **THEN** status, consumables, summary, records and rooms use local V1 TCP and current-map bytes use the explicitly configured vendor MQTT route
- **AND** failure of a local read does not cause a cloud read or a different target selection

#### Scenario: Prohibited RPC cannot be transmitted

- **WHEN** an untyped or malformed caller attempts cleaning, `load_multi_map`, `get_photo`, discovery or an arbitrary RPC, including during connection
- **THEN** the boundary refuses the attempt without sending bytes
- **AND** account setup and transport construction send no robot RPC

### Requirement: Private account setup is explicit

The transport SHALL support owner-run interactive email-code setup through a qualified account flow, without accepting a password or code in command arguments. Routine reads MUST reuse a privately loaded session and MUST NOT initiate login after authentication refusal. Session and configuration inputs MUST reject symlinks, unsafe permissions and malformed content; created credential files MUST be private outside Git and publishable output. Secrets MUST NOT appear in returned errors, diagnostics or fixtures. (Hub #1070 AC2, AC4.)

#### Scenario: Fake account setup and session reuse

- **WHEN** the owner explicitly starts setup with interactive input against synthetic account endpoints
- **THEN** setup requests a code, accepts it interactively and stores a private session with enough qualified information for the selected robot
- **AND** later reads reuse that session without another account login

#### Scenario: Authentication refusal

- **WHEN** the account service or transport refuses authentication
- **THEN** the caller receives the shared nonretryable `unauthenticated` error with fixed safe detail
- **AND** no automatic login, credential capture or response-body diagnostic occurs

#### Scenario: Unsafe credential input

- **WHEN** a session or configuration input is symlinked, writable or readable by other users, or malformed
- **THEN** it is refused before any network use
- **AND** the refusal reveals no session material

### Requirement: Responses are correlated and bounded

The transport MUST validate V1 framing, encryption, checksums, operation response shape and correlation before returning an observation. It SHALL cap frame buffers, response size, map decompression and pending requests. It MUST reject malformed, oversized, mismatched or unsupported responses through the shared error registry without exposing their contents. Raw current-map bytes SHALL remain a private return value, separate from profile messages. (Hub #1070 AC2, AC4.)

#### Scenario: Fragmented synthetic local response

- **WHEN** a synthetic TCP server returns an encrypted approved-operation response in fragments
- **THEN** the transport returns it only after the complete valid frame matches the active request
- **AND** an unrelated request ID cannot satisfy the read

#### Scenario: Invalid or oversized response

- **WHEN** a synthetic peer sends invalid framing, checksum, required fields or map data, or exceeds the documented byte limits
- **THEN** the read fails with a safe registry error within its deadline
- **AND** no unbounded allocation or decompression occurs

#### Scenario: Synthetic current-map reply

- **WHEN** the configured synthetic MQTT peer returns the qualified encrypted V1 map envelope for the active map request
- **THEN** the transport validates correlation and returns bounded decompressed raw map bytes
- **AND** no photo request or map switch is issued

### Requirement: One owner serializes reads and retires work

The transport SHALL serialize read attempts with bounded pending work, deadlines, cancellation and capped retry/backoff for observational failures. Stop MUST close sockets and subscriptions, cancel queued and in-flight work, and prevent late delivery. A failure SHALL remain a transport result rather than an exception that fails an unrelated runtime module. Safe diagnostics SHALL preserve internal trace correlation without sending it to the device or vendor; repeated observation failures SHALL be summarized. (Hub #1070 AC2, AC4.)

#### Scenario: Deadline, disconnect and retry

- **WHEN** a synthetic read disconnects or remains unanswered until its deadline
- **THEN** it returns an appropriate registry error and releases its active slot
- **AND** any eligible retry remains inside the same deadline and documented attempt/backoff caps

#### Scenario: Pending capacity

- **WHEN** callers exceed the documented pending-read cap
- **THEN** excess work receives `capacity` without opening another device connection
- **AND** accepted reads remain serialized

#### Scenario: Cancellation and stop fence late replies

- **WHEN** a caller cancels a read or stops the transport while a response is pending
- **THEN** queued and in-flight work is retired with `cancelled`
- **AND** a later response cannot resolve a successful observation or start another request

### Requirement: Qualification evidence stays separate from live compatibility

The source deliverable SHALL retain pinned protocol/license provenance, synthetic vectors and canonical build/type/lint/SDK/event/workflow/transport checks. It MUST NOT use an owner account, session or robot for source qualification, or imply that synthetic success proves exact-firmware or installed acceptance. (Hub #1070 AC1, AC5-6.)

#### Scenario: Source consumer qualification

- **WHEN** the source transport is qualified for its dependent module
- **THEN** its published interface is exercised by a contract consumer and all required source checks and independent reviews have retained evidence
- **AND** the result states which protocol behavior is supported and that actual-device compatibility remains separately unverified
