## Purpose

Provide local-only observed power and guarded manual/Hub automation controls for the two explicitly configured Wemo F7C063 lamp plugs.

## Requirements

### Requirement: Configured local-only identities
The runtime SHALL use one shipped TypeScript module for at most two explicitly configured F7C063 plugs. Each SHALL have a distinct routing identity, alias, address and observed device identity. No app login, cloud account, discovery, callback listener, native-rule management or sidecar SHALL be required. Wrong identities and unsupported configurations SHALL be unavailable without device writes.

#### Scenario: Address belongs to a different plug
- **WHEN** the configured address reports a different identity or foreign control origin
- **THEN** the owner refuses the write and reports unavailable without rediscovery or retry

### Requirement: Independent observed power and guarded commands
Each plug SHALL have an independent bounded queue and one designated writer, using SDK device/power families, durable command fences and outcome outbox under ADR 0012. On/off requests SHALL recheck expiry, configuration, generation and durable admission immediately before transport effects. Observed power SHALL carry its actual read time; absent, malformed, offline or stale evidence SHALL never appear freshly off. A transmitted command SHALL remain distinct from observed power. Polling SHALL have a stated delay and SHALL not switch a plug.

#### Scenario: One plug fails while another responds
- **WHEN** one configured plug times out and a second receives a valid on request
- **THEN** only the first becomes unavailable and the second completes through its own queue

#### Scenario: Duplicate or interrupted command
- **WHEN** a request is duplicated or the owner restarts with accepted/started work
- **THEN** a matching fence prevents another device effect and interrupted work is settled failed or uncertain without replay

### Requirement: Explicit power-only uncertain-hold recovery
An uncertain power write SHALL durably hold that plug. Polls, restart, schedule and maximum-on evaluation SHALL not clear the hold or resend the action. A new explicit hold-release command SHALL require the current configuration/generation and exact held request, perform a fresh identity/state read, clear only that hold and send no power command.

#### Scenario: A person releases a current hold
- **WHEN** an authorized new hold-release command names the current held request and fresh identity/power reading succeeds
- **THEN** the hold clears without repeating the uncertain write, while its original outcome remains uncertain

### Requirement: Truthful dashboard and qualification boundaries
The existing dashboard SHALL show configured aliases, observed power and age, supported power controls, command outcomes and held state. Only supported controls SHALL appear. Read-only, stale and disconnected sessions SHALL not switch devices. Source/simulation, installed acceptance and physical behavior SHALL remain distinct.

#### Scenario: Read-only session opens a plug card
- **WHEN** the owner reads a plug with read-only authority
- **THEN** its observation and enforcement status remain visible and mutations are refused before device work
