## Purpose

Own a narrowly configured Windows BB-8 BLE transport with bounded transactions and recoverable private receipts, independent of canonical WSL state.

## ADDED Requirements

### Requirement: Source-bound internal operations
The helper SHALL answer `bb8-link-execute/2.0` and `bb8-link-recorded/2.0` only from `bunny/modules/bb8`. Execute SHALL require equal requestId/operationId, parent ID, configured revision, helper epoch, connection generation, finite operation deadline and a closed typed operation. Unknown fields, wrong target, expired/uncertain clocks and stale identity SHALL refuse before effect. Native loading and radio access SHALL wait for explicit connect and exclusive writer ownership.

#### Scenario: Forged or stale request
- **WHEN** a browser, ordinary credential or another module requests an internal operation, or valid source uses stale guards
- **THEN** no BLE access occurs and a registered refusal is returned

### Requirement: Bounded PacketV1 transport
The helper SHALL use one active operation, at most eight pending, 20-byte chunks at least 60 ms apart, a 1 KiB collector, 15 s connect/handshake, 2 s response and 5 s other-operation bounds. Every effect SHALL recheck deadline, stream, identity and generation. Responses SHALL validate framing, declared length, checksum and matching sequence; bounded notifications SHALL never refresh unrelated observations. Connect SHALL record one ping and one eight-byte version reply. Only the selected allowlist SHALL be writable.

#### Scenario: Fragmented and corrupt replies
- **WHEN** replies are split, coalesced, truncated, corrupt or have a stale sequence
- **THEN** only a fully validated matching reply completes its transaction, buffers stay bounded and timeout sends no retry

### Requirement: Durable receipts and interrupted recovery
The helper SHALL persist admission and effect-start before the first possible write. Result state and internal outcome SHALL commit atomically. At most 64 unconsumed results SHALL be retained; capacity or failed admission storage SHALL refuse before effect. Operation IDs SHALL remain remembered through their deadline after consumption; repeats SHALL never reexecute. Core outcome acknowledgment SHALL not retire a result; only module consumption SHALL. Restart or stream loss SHALL invalidate queued work and never reopen BLE or replay a packet.

#### Scenario: Crash boundaries and duplicate
- **WHEN** restart occurs before an effect, after possible effect or after result commit, and the same operation is submitted again
- **THEN** recovery reports failed, uncertain or the stored result respectively and the duplicate sends no packet

#### Scenario: Separate acknowledgments
- **WHEN** the core acknowledges an outcome before WSL consumes its result
- **THEN** the result remains syncable until authenticated module consumption and its ID remains fenced through its deadline
