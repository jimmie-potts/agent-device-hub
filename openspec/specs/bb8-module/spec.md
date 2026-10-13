# bb8-module Specification

## Purpose

Provide explicit enrolled BB-8 docked LED, status and fixed head-gesture controls through B.U.N.N.Y., preserving truthful evidence and passive reads while floor driving is hibernated.

## Requirements

### Requirement: Passive enrolled BB-8 owner
The module SHALL own `device/2.1` and `bb8-robot/2.0` for one configured neutral routing ID. Start, page entry, reads and software reconnect SHALL send no radio command. General capabilities SHALL remain unsupported. Public metadata SHALL exclude addresses, native errors, raw packets and credentials.

#### Scenario: Opening the controls
- **WHEN** an operator opens or reloads the BB-8 page and reads its state
- **THEN** the page shows connection and separately timed power evidence, with no scan, connection, wake or LED write

### Requirement: Guarded explicit controls
The module SHALL answer connect, disconnect, wake, main RGB/tail brightness, power refresh, named docked gestures and Stop. New public forward-reference and directional-step requests SHALL return unsupported-capability before durable admission or helper dispatch. Public requests SHALL require requestId, configuration revision, helper epoch and connection generation; LED values SHALL be bytes. Wrong target, stale guards, unknown fields, expired admission, unavailable helper or unsupported operation SHALL refuse before effects. Accepted SHALL mean durable responsibility, not visible success. Existing schemas and stored outcomes SHALL remain readable.

#### Scenario: Deliberate LED change
- **WHEN** an authorized operator sends an in-date guarded main RGB command
- **THEN** one matching internal operation is requested and its eventual public outcome distinguishes transmission from physical observation

#### Scenario: Refused commands
- **WHEN** a request names another target, arbitrary bytes, stale guards, expired admission or hibernated aiming/driving
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
The browser-only React frontend SHALL use the existing SDK context and tracked Command control. It SHALL present docked connection/wake, LEDs, power evidence, disconnect and named docked gestures with Stop gesture, and SHALL expose no aiming or floor-step controls. The operator SHALL explicitly confirm the powered dock before selecting a gesture. Read-only and stale contexts SHALL disable effects. The page SHALL distinguish accepted, completed, uncertain, unknown and stale evidence, and gesture/LED completion SHALL report transmission rather than visible success. The connection control SHALL say “Connect and wake” and explain its effects. Reconnect SHALL replace sync membership without refreshing old telemetry and reset the dock confirmation.

#### Scenario: Reader and stale power
- **WHEN** a read-only caller opens the page after a power report becomes stale
- **THEN** it sees the report's original time and stale status, disabled command controls and no aiming/driving controls

#### Scenario: Deliberate dock gesture
- **WHEN** an operator confirms the powered dock and chooses a named gesture
- **THEN** one tracked guarded gesture is submitted, with independently tracked Stop available during pending or uncertain work

#### Scenario: Connection effect is visible before activation
- **WHEN** an operator inspects the disconnected robot controls
- **THEN** Connect and wake names its effect before activation; opening the page sends no command

### Requirement: Named docked gestures
The module SHALL accept only look-left, look-right and shake-head, with explicit docked confirmation. The helper SHALL obtain a fresh charging report before each zero-speed heading segment and refuse a missing, malformed or non-charging report before that segment. Only one gesture SHALL be pending or active. Stop SHALL remain independently admitted during uncertain work. No arbitrary speed, duration, heading, animation ID, script, raw-motor or firmware option SHALL be accepted. Restart/reconnect SHALL replay no gesture.

#### Scenario: Charging prerequisite
- **WHEN** a gesture lacks dock confirmation or a fresh charging report
- **THEN** no heading/motor request for that segment occurs

#### Scenario: Old page or caller
- **WHEN** an old client submits a previously valid aim or step request
- **THEN** the module refuses before persisting responsibility or requesting the helper

### Requirement: Owner-selected indefinite hibernation
While BB-8 is hibernated, its earlier active-use and verification requirements SHALL remain historical and inactive. Default unit, scenario, browser and CI runs SHALL execute no BB-8 feature checks. Source, dormant tests and private state SHALL remain retained; resumption SHALL require a new owner decision.

#### Scenario: Other product work runs CI
- **WHEN** ordinary project checks run during hibernation
- **THEN** they execute no BB-8 module, package, browser or shared BB-8 behavior cases

#### Scenario: Installed integration is disabled
- **WHEN** hibernation is applied to the established installation
- **THEN** its BB-8 configuration and helper grant are inactive and the helper remains stopped without clearing its stores
