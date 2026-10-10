## Purpose

Provide explicit enrolled BB-8 LED and status controls through B.U.N.N.Y., preserving truthful evidence and passive reads.

## ADDED Requirements

### Requirement: Passive enrolled BB-8 owner
The module SHALL own `device/2.1` and `bb8-robot/2.0` for one configured neutral routing ID. Start, page entry, reads and software reconnect SHALL send no radio command. General capabilities SHALL remain unsupported. Public metadata SHALL exclude addresses, native errors, raw packets and credentials.

#### Scenario: Opening the controls
- **WHEN** an operator opens or reloads the BB-8 page and reads its state
- **THEN** the page shows connection and separately timed power evidence, with no scan, connection, wake or LED write

### Requirement: Guarded explicit controls
The module SHALL answer only connect, disconnect, wake, main RGB/tail brightness and power refresh. Public requests SHALL require requestId, configuration revision, helper epoch and connection generation; LED values SHALL be bytes. Wrong target, stale guards, unknown fields, expired admission, unavailable helper or unsupported operation SHALL refuse before effects. Accepted SHALL mean durable responsibility, not visible success.

#### Scenario: Deliberate LED change
- **WHEN** an authorized operator sends an in-date guarded main RGB command
- **THEN** one matching internal operation is requested and its eventual public outcome distinguishes transmission from physical observation

#### Scenario: Refused commands
- **WHEN** a request names another target, motion, arbitrary bytes, stale guards or an expired admission
- **THEN** it causes no device write and returns a registered refusal

### Requirement: Durable public outcomes without replay
The module SHALL commit accepted responsibility before asking the helper, and canonical state/outcomes before publication. Recovery SHALL reconcile matching stored helper receipts, fail proven unsent work and mark ambiguous work uncertain. Outcome retry SHALL never execute stored work. Receipt consumption SHALL occur only after public completion commits.

#### Scenario: Restart after a possible send
- **WHEN** the module restarts with interrupted responsibility and a helper receipt
- **THEN** it completes from that receipt and acknowledges consumption without another execute request

#### Scenario: Publication failure
- **WHEN** publication fails after completion commits
- **THEN** restart republishes the unchanged outcome and sends no device command

### Requirement: Evidence-aware React controls
The module SHALL export a browser-only React frontend through the existing SDK context and shared tracked Command control. Read-only callers SHALL see state with disabled effects. The page SHALL distinguish accepted, completed, uncertain, unknown and stale evidence, expose explicit effects and show motion unavailable. Reconnect SHALL replace sync membership without refreshing old telemetry.

#### Scenario: Reader and stale power
- **WHEN** a read-only caller opens the page after a power report becomes stale
- **THEN** it sees the report's original time and stale status, unavailable motion and disabled command controls
