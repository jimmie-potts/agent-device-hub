## MODIFIED Requirements

### Requirement: Capture state is a core responsibility

The runtime SHALL publish and sync one authoritative current music-capture record through its core, using `/2.1` while accepting supported `/2.0` inputs. It SHALL apply existing durable operator admission, command outcome, history and safe-error rules. Configured microphone capability SHALL describe selection support only. The core SHALL bind a microphone start to the advertised alias, endpoint and generation, and refuse another input's features. Capture state SHALL NOT change device modes, send speaker commands or establish light participation.

#### Scenario: Explicit capture without lights
- **WHEN** an admitted operator starts a supported Music or configured microphone input
- **THEN** the core records the selected input before dispatch, reports the resulting capture lifecycle and leaves every device's mode and presentation unchanged

#### Scenario: Another input's frame
- **WHEN** a feature names the current generation but another input or microphone alias
- **THEN** it cannot make the session active or refresh its validity

#### Scenario: Changed capability
- **WHEN** a producer attempts to replace the configured microphone on an existing endpoint
- **THEN** the core refuses the replacement without refreshing its clock qualification; a changed selection requires an explicit new producer invocation

#### Scenario: Old durable state and restart
- **WHEN** the upgraded runtime reads a prior Music-only state or restarts after microphone capture
- **THEN** it can serve its single current record, retires old endpoint capability and unfinished authority truthfully, and sends no prior start again

#### Scenario: Configured microphone in shared controls
- **WHEN** the shared controls receive a supported state record with a configured microphone alias
- **THEN** they offer that alias for explicit selection without claiming device presence or permission; Start names the selection and an unavailable or refused input is reported honestly
