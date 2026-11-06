## ADDED Requirements

### Requirement: Exact Pixoo art can carry a deterministic forecast notice
The Pixoo SHALL advertise rain-notice support only with a renderer that shows a fixed readable forecast annotation beside exact saved art on 64×64. Notice-bearing moments SHALL require that capability, closed bounded data and evidence valid through the latest permitted start and intended hold, rechecked before a delayed first write. The annotation SHALL distinguish a forecast from an observation and chance from likely rain, preserve the exact staged composition identity and bytes, and use no free caller/provider text. Monitor/Media, explicit pause, attention, owner pins, Now Playing precedence, start-window checks and current-base restoration SHALL remain unchanged. A notice SHALL grant no mode change or broader empty-Media exception.

#### Scenario: Forecast art in an eligible presentation
- **WHEN** an eligible Pixoo receives the default 10-second exact art moment and a rain notice valid through that hold
- **THEN** its native-size frames show the readable fixed annotation outside the fitted decorative image and its normal end returns to the base current at that time

#### Scenario: A factual appearance is unsupported or superseded
- **WHEN** notice support is absent, evidence becomes invalid before admission, or an explicit pause/manual takeover wins
- **THEN** the target reports refusal or its typed terminal outcome without silently stripping the label, changing mode or restoring an obsolete base

#### Scenario: The selected route cannot carry the labelled art
- **WHEN** the hosted route's 256-color GIF palette cannot hold the annotation beside an otherwise admissible exact original
- **THEN** the moment fails `unsupported-capability` with no transmission evidence, before any file is published or command sent
- **AND** the current base stays current, so Monitor is not suspended by that refusal

#### Scenario: Transport consumes the forecast hold
- **WHEN** a slow upload or push consumes the remaining notice validity after effects begin
- **THEN** the existing owner caps its hold at source stale time or forecast end and reports an interrupted/cancelled attempt rather than completion of the full requested duration
- **AND** current-base restoration retains its own failed or uncertain evidence without resend or a claim that physical pixels cleared
