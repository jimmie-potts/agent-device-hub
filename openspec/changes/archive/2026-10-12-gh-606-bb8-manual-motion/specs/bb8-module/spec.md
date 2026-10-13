## MODIFIED Requirements

### Requirement: Guarded explicit controls
The module SHALL answer connect, disconnect, wake, main RGB/tail brightness, power refresh, set/clear forward reference, discrete directional steps and Stop. Public requests SHALL require requestId, configuration revision, helper epoch and connection generation; LED values SHALL be bytes. Wrong target, stale guards, unknown fields, expired admission, unavailable helper or unsupported operation SHALL refuse before effects. Accepted SHALL mean durable responsibility, not visible success.

#### Scenario: Deliberate LED change
- **WHEN** an authorized operator sends an in-date guarded main RGB command
- **THEN** one matching internal operation is requested and its eventual public outcome distinguishes transmission from physical observation

#### Scenario: Refused commands
- **WHEN** a request names another target, continuous drive, arbitrary bytes, stale guards or an expired admission
- **THEN** it causes no device write and returns a registered refusal

### Requirement: Evidence-aware React controls
The module SHALL export a browser-only React frontend through the existing SDK context and shared tracked Command control. Read-only callers SHALL see state with disabled effects. The page SHALL distinguish accepted, completed, uncertain, unknown and stale evidence, expose explicit effects and offer Set/Clear forward, four short steps and Stop. Stop SHALL remain available on a live connected link while an ordinary attempt is pending or movement is fenced. Movement completion SHALL report transmission, never observed rest. The connection control SHALL say “Connect and wake” and explain that it wakes the robot before checking protocol replies. Reconnect SHALL replace sync membership without refreshing old telemetry.

#### Scenario: Reader and stale power
- **WHEN** a read-only caller opens the page after a power report becomes stale
- **THEN** it sees the report's original time and stale status, disabled command controls

#### Scenario: Connection effect is visible before activation
- **WHEN** an operator inspects the disconnected robot controls
- **THEN** Connect and wake names its effect before activation; merely opening the page sends no connection or wake command

## ADDED Requirements

### Requirement: Bounded supervised movement
Steps SHALL require the current helper-owned forward reference, one of forward/right/back/left, speed1–32 and duration100–500ms. Only one pending or active step SHALL be admitted. Stop SHALL require current identity/link guards but not a forward reference or a cleared uncertain hold. Reference SHALL be invalid after reconnect/restart, explicit clear/reposition or uncertain movement. Every command SHALL retain SDK tracking and no replay.

#### Scenario: Missing or stale forward reference
- **WHEN** an operator requests a step without the current reference or with out-of-bound values
- **THEN** no movement write occurs and a registered refusal is returned

#### Scenario: Stop while movement is pending
- **WHEN** the operator clicks Stop while a step is waiting or movement is fenced
- **THEN** the page submits one fresh tracked Stop while refusing additional steps, and distinguishes transmission from physically observed rest
