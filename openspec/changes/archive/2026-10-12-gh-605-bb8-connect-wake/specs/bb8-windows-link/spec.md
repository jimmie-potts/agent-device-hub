## MODIFIED Requirements

### Requirement: Bounded PacketV1 transport
The helper SHALL use one active operation, at most eight pending, 20-byte chunks at least 60 ms apart, a 1 KiB collector, 15 s connect/handshake, 2 s response and 5 s other-operation bounds. Every effect SHALL recheck deadline, stream, identity and generation. Responses SHALL validate framing, declared length, checksum and matching sequence; bounded notifications SHALL never refresh unrelated observations. Explicit Connect SHALL write one wake after unlock/transmit-power initialization and before one ping and one eight-byte version reply; missing wake support SHALL refuse before initialization writes. Startup and software reconnect SHALL remain passive. Only the selected allowlist SHALL be writable.

#### Scenario: Fragmented and corrupt replies
- **WHEN** replies are split, coalesced, truncated, corrupt or have a stale sequence
- **THEN** only a fully validated matching reply completes its transaction, buffers stay bounded and timeout sends no retry

#### Scenario: Sleeping original BB-8
- **WHEN** an authorized operator explicitly connects to an enrolled sleeping original BB-8
- **THEN** one guarded wake precedes ping/version, validated replies establish connection, and a failed wake or reply produces no retry or later initialization write
