## ADDED Requirements

### Requirement: Exact Tidbyt art can carry a deterministic forecast notice
A Tidbyt backend SHALL declare rain-notice support only when its art moment renderer can show a fixed readable forecast annotation beside the exact saved art on 64×32. A notice-bearing moment SHALL require the declared capability, valid bounded notice data and evidence valid through its latest permitted start and intended hold, rechecked before a delayed first write. The renderer SHALL reserve enough high-contrast text area to distinguish forecast and chance/likely rain with its hour, fit the unchanged decorative composition separately, and never interpret provider or caller free text as a fact. Existing pin, attention, mode, start-window, one-writer and current-base return protections SHALL apply unchanged.

#### Scenario: A supported forecast appearance
- **WHEN** a qualified art-capable backend accepts the default 30-second exact art moment with chance-of-rain evidence valid through that hold
- **THEN** native-size rendered frames show a readable forecast/chance label outside the fitted image, the staged composition hash remains unchanged and the normal moment release returns to the current base

#### Scenario: The target or evidence cannot support the notice
- **WHEN** the backend lacks notice support, the notice is malformed/stale, or a pin/attention state blocks the moment
- **THEN** it returns the appropriate typed refusal or failed outcome without showing an unlabelled replacement or bypassing the current writer

#### Scenario: Transport consumes the forecast hold
- **WHEN** a slow upload or push consumes the remaining notice validity after effects begin
- **THEN** the existing owner caps its hold at source stale time or forecast end and reports an interrupted/cancelled attempt rather than completion of the full requested duration
- **AND** current-base restoration retains its own failed or uncertain evidence without resend or a claim that physical pixels cleared
