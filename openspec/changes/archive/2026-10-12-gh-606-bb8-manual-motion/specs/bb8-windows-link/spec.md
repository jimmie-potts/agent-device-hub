## MODIFIED Requirements

### Requirement: Bounded PacketV1 transport
The helper SHALL use one active operation, at most eight pending, 20-byte chunks at least 60 ms apart, a 1 KiB collector, 15 s connect/handshake, 2 s response and 5 s other-operation bounds. Every requested effect SHALL recheck deadline, stream, identity and generation. A step's selected completion Stop SHALL have its own bounded response budget and selected writer/link/identity checks, independent of the original step expiry; this exception SHALL send no new movement. Responses SHALL validate framing, declared length, checksum and matching sequence; bounded notifications SHALL never refresh unrelated observations. Explicit Connect SHALL write one wake after unlock/transmit-power initialization and before one ping and one eight-byte version reply; missing wake support SHALL refuse before initialization writes. Startup and software reconnect SHALL remain passive. Only the selected allowlist SHALL be writable.

#### Scenario: Fragmented and corrupt replies
- **WHEN** replies are split, coalesced, truncated, corrupt or have a stale sequence
- **THEN** only a fully validated matching reply completes its transaction, buffers stay bounded and timeout sends no retry

#### Scenario: Sleeping original BB-8
- **WHEN** an authorized operator explicitly connects to an enrolled sleeping original BB-8
- **THEN** one guarded wake precedes ping/version, validated replies establish connection, and a failed wake or reply produces no retry or later initialization write

## ADDED Requirements

### Requirement: Local step deadline and priority Stop
The Windows writer SHALL admit at most one step, bounded to speed1–32 and duration100–500ms with a current forward reference. It SHALL send the selected Stop locally when the step ends, without waiting for a GO reply or another browser command. Explicit Stop SHALL take priority over queued movement and remain usable on an available connected link while the reference is invalid. The queue and retained-results bounds SHALL reserve a Stop slot while a step exists. Packet sequence numbers SHALL not wrap or allow a late GO reply to complete Stop. A missing response SHALL never cause movement replay.

#### Scenario: Timed step with a late GO response
- **WHEN** a valid short step reaches its local deadline before the GO reply
- **THEN** the selected Stop is requested with a distinct sequence, the late GO reply cannot complete it, and the unconfirmed movement result remains uncertain

#### Scenario: Operator Stop interrupts a step
- **WHEN** an explicit Stop arrives during an active step or behind pending movement
- **THEN** the active step's wait ends, its selected completion Stop runs, and the explicit Stop executes ahead of queued work; another step cannot extend movement

### Requirement: Ephemeral manual forward reference
Set forward SHALL establish a new helper-owned reference only after bounded stabilization-off, heading-zero and stabilization-on replies. Clear forward SHALL invalidate the reference without a radio effect. Reconnect, wake, restart, loss or uncertain motion SHALL invalidate it. An unavailable radio or host SHALL not be reported as physically stopped.

#### Scenario: Restart after an interrupted move
- **WHEN** the helper restarts with an admitted or effect-start step
- **THEN** it reports the stored interrupted responsibility, starts disconnected without a forward reference and sends no radio or movement packet
