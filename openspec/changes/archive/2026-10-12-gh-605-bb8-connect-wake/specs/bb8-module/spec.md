## MODIFIED Requirements

### Requirement: Evidence-aware React controls
The module SHALL export a browser-only React frontend through the existing SDK context and shared tracked Command control. Read-only callers SHALL see state with disabled effects. The page SHALL distinguish accepted, completed, uncertain, unknown and stale evidence, expose explicit effects and show motion unavailable. The connection control SHALL say “Connect and wake” and explain that it wakes the robot before checking protocol replies. Reconnect SHALL replace sync membership without refreshing old telemetry.

#### Scenario: Reader and stale power
- **WHEN** a read-only caller opens the page after a power report becomes stale
- **THEN** it sees the report's original time and stale status, unavailable motion and disabled command controls

#### Scenario: Connection effect is visible before activation
- **WHEN** an operator inspects the disconnected robot controls
- **THEN** Connect and wake names its effect before activation; merely opening the page sends no connection or wake command
