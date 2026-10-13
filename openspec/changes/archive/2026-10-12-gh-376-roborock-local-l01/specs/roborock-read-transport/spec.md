## MODIFIED Requirements

### Requirement: Only explicit read operations reach the target

The transport SHALL expose status, consumables, cleaning summary, one cleaning record, room mapping and current-map bytes. Its final send boundary MUST allow only `get_status`, `get_consumable`, `get_clean_summary`, `get_clean_record`, `get_room_mapping` and `get_map_v1`, with fixed operation-specific parameters. It MUST NOT expose a generic RPC to consumers, discover targets, change maps, retrieve photos or command cleaning. Construction, import and simulation SHALL perform no network operation. (Hub #1070 AC1-3.)

#### Scenario: Each approved read uses its qualified route

- **WHEN** a caller explicitly reads each supported operation for the configured target
- **THEN** status, consumables, summary, records and rooms use the explicitly selected local TCP framing and current-map bytes use the explicitly configured vendor MQTT route
- **AND** failure of a local read does not cause a cloud read or a different target selection

#### Scenario: Prohibited RPC cannot be transmitted

- **WHEN** an untyped or malformed caller attempts cleaning, `load_multi_map`, `get_photo`, discovery or an arbitrary RPC, including during connection
- **THEN** the boundary refuses the attempt without sending bytes
- **AND** account setup and transport construction send no robot RPC


### Requirement: Responses are correlated and bounded

The transport MUST validate the selected local framing, encryption, checksums and L01 authentication tags where applicable, as well as operation response shape and correlation before returning an observation. It SHALL cap frame buffers, response size, map decompression and pending requests. It MUST reject malformed, oversized, mismatched or unsupported responses through the shared error registry without exposing their contents. Raw current-map bytes SHALL remain a private return value, separate from profile messages. (Hub #1070 AC2, AC4.)

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


## ADDED Requirements

### Requirement: Local socket framing is selected explicitly

The private target SHALL accept only an optional `localProtocol` of `1.0` or `L01`; absence SHALL retain legacy `1.0` behavior. Account API protocol and vendor-MQTT map framing SHALL remain `1.0`. L01 reads MUST authenticate encrypted replies with the current connection's client and acknowledgment nonces before returning a correlated observation. The transport MUST NOT negotiate, discover, fall back or add an initialization RPC. Existing private input, final read allowlist, deadline, serialization, cancellation and safe error protections SHALL apply to both selections. (Hub #376 AC6 compatibility; #1070 read boundary.)

#### Scenario: Existing private target remains compatible

- **WHEN** a valid existing private target omits the local selection
- **THEN** local reads retain the legacy framing and the selected map route remains V1 vendor MQTT

#### Scenario: Selected L01 read

- **WHEN** a target explicitly selects L01 and its peer returns a valid handshake and authenticated correlated read response
- **THEN** the caller receives that read through the existing typed interface
- **AND** only the requested allowlisted RPC is sent

#### Scenario: Authentication or selection refusal

- **WHEN** a selection is unknown or a reply has a corrupt tag, wrong connection nonces, wrong request ID or mismatched wire version
- **THEN** no successful observation is returned and no alternate protocol, target, login or cloud read is attempted

#### Scenario: L01 cancellation and prohibited calls

- **WHEN** a selected L01 read is cancelled or an untyped caller requests a prohibited RPC
- **THEN** the pending socket is retired or the call is refused before connection, respectively
- **AND** no late reply establishes an observation or sends another request
