## ADDED Requirements

### Requirement: Shared versioned response interpretation

A single browser-safe response implementation SHALL apply gate, sensitivity and band emphasis before clamping and one source-time exponential smoother. Numerical preview and explicit renderer V2 SHALL share it. Renderer V1 SHALL retain its existing interpretation and defaults exactly. V2 SHALL reject duplicate legacy tuning fields. No response computation SHALL admit device work or claim physical timing.

#### Scenario: Preview and renderer agree
- **WHEN** preview and V2 receive identical valid samples and response settings on synthetic Lines or NL22 layouts
- **THEN** the normalized levels agree, only one smoothing step applies and rendered output obeys existing bounds

#### Scenario: Gate closure and expiry
- **WHEN** valid quiet samples close an enabled gate
- **THEN** targets become zero with the documented smoothing decay; stale input clears preview immediately instead of continuing a live-looking decay

#### Scenario: Preserved V1 and explicit V2
- **WHEN** existing V1 recipes replay or a V2 recipe supplies legacy sensitivity/smoothing fields
- **THEN** V1 output remains identical and the conflicting V2 recipe is refused

#### Scenario: Rejected output preserves V1 state
- **WHEN** an output exceeds the existing payload capacity
- **THEN** the rejected window cannot change the response used by the next accepted V1 output
