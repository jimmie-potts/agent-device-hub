## ADDED Requirements

### Requirement: Narrow music producer principal

A host music-producer credential SHALL have a fixed producer source, no ordinary scopes and only the capture endpoint families it needs. Read, control, ingest and browser authority SHALL NOT imply music-producer authority. Endpoint closure SHALL notify the capture owner and retire capture authority. Reconnection SHALL restore no capture endpoint or session.

#### Scenario: Producer cannot control devices
- **WHEN** the producer attempts a device command, unrelated publication or general state read
- **THEN** the gateway refuses it without dispatching the call

#### Scenario: Lost endpoint
- **WHEN** the producer endpoint or its authenticated connection closes
- **THEN** the gateway notifies the capture owner, queued endpoint requests retire and the producer cancels local capture

### Requirement: Capture state is a core responsibility

The runtime SHALL publish and sync one authoritative current music-capture record through its core. It SHALL apply existing durable operator admission, command outcome, history and safe-error rules. Capture state SHALL NOT change device modes, send speaker commands or establish light participation.

#### Scenario: Explicit capture without lights
- **WHEN** an admitted operator starts the supported capture input
- **THEN** the core reports the resulting capture lifecycle while every device's mode and presentation remain unchanged
