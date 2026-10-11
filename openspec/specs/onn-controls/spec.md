# ONN controls Specification

## Purpose

Provide owner-requested controls for one configured ONN through the authenticated runtime, with truthful outcomes, private no-replay records and an accessible shared-dashboard page.

## Requirements

### Requirement: One fixed ONN controls owner

The module SHALL own one configured ONN and expose only Up, Down, Left, Right, Select, Back, Home, play/pause, the standard YouTube/Stremio shortcuts and focused safe text without submission. Every client SHALL use the same authenticated tracked handler. Commands SHALL refuse wrong target, invalid guards, extra fields, unsupported input and unqualified power/volume/sleep/seek operations before effects. Seeking SHALL remain individual navigation of an explicitly focused timeline followed by a separate Select where needed; no inferred focus or macro is permitted. Missing configuration or device failure SHALL preserve the running core and unrelated modules.

#### Scenario: Required controls and exclusions
- **WHEN** a configured owner sends each qualified action through dashboard or compatible MCP
- **THEN** one corresponding control attempt is ordered for the fixed ONN, and a read-only caller or arbitrary target/package/shell input is refused before effects
- **WHEN** the owner seeks using the focused timeline
- **THEN** Left/Right remain ordinary single keys and Select remains a separate explicit action

### Requirement: Bounded truthful execution without replay

One serialized writer SHALL hold at most sixteen accepted pending actions. It SHALL commit a private fence before accepting responsibility and a started record before any possible effect. Each action SHALL finish within its five-second operation bound and command expiry; queued expiry or failed admission SHALL have no effect. Lost replies after possible transmission SHALL remain uncertain, command acknowledgment SHALL mean transmitted only, and only separate observation SHALL mean observed. Duplicate IDs, restart, reconnect, outbox publication, page load and physical-remote changes SHALL never repeat or compensate an action. Interrupted work SHALL settle from its durable stage without execution.

#### Scenario: Queue expiry and uncertainty
- **WHEN** an action expires while queued, admission storage fails, or capacity is exhausted
- **THEN** no device effect is attempted and the appropriate registered refusal or failed outcome is visible
- **WHEN** a reply is lost after an effect could begin
- **THEN** the outcome is uncertain and no retry is sent

#### Scenario: Restart and intentional repeats
- **WHEN** the runtime restarts with admitted or started work or republishes an outcome
- **THEN** it reports failed or uncertain work and sends no old command
- **WHEN** two deliberate identical presses have distinct request IDs
- **THEN** each executes once in order

### Requirement: Private focused text and minimal state

Focused text SHALL be nonempty, at most 256 characters and limited to the qualified safe ASCII representation. It SHALL remain memory-only across core/module records, SQLite/WAL, inbox/history/outbox, diagnostics, host arguments/environment/files and browser storage. Private HMAC identity SHALL preserve semantic duplicate/conflict detection; missing or changed key identity SHALL refuse before effects. Current-app evidence SHALL be timestamped and distinguish known YouTube, Stremio, none or other from unknown/stale, without publishing a private package or address. Read-only polling SHALL be bounded to five seconds, spaced by five seconds, with known evidence stale after fifteen seconds.

#### Scenario: Text privacy and unavailable identity
- **WHEN** focused text is admitted or fails, and the process restarts
- **THEN** no plaintext survives on durable surfaces; retained identity/outcomes prevent replay and a missing or changed private key refuses further sensitive effects

#### Scenario: Read-only current state
- **WHEN** a page opens, reconnects or reads a stale/unavailable ONN
- **THEN** it shows honest unknown/stale evidence and sends no control command

### Requirement: Accessible module page and compatible MCP

The ONN-owned React page SHALL compile into the shared dashboard, reuse authenticated connection and command feedback, provide keyboard/phone/desktop operation and label focus-dependent seeking and focused text. It SHALL disable unavailable, stale or forbidden actions visibly and distinguish admission, transmission and observation. A compatible MCP client SHALL discover ONN state and send the same typed actions through the existing core tool without a native assistant or model call.

#### Scenario: Browser and MCP share controls
- **WHEN** an authorized client sends a key or shortcut, or a reader opens the page and reads state
- **THEN** the handler and outcome are shared, reader controls are refused, and reload/reconnect never sends an action
