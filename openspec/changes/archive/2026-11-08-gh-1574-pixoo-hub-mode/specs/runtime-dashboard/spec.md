## MODIFIED Requirements

### Requirement: General controls from named runtime owners
The dashboard SHALL sync device records from each declared owner and operations from the core through its existing SDK participant. It SHALL show desired state, observed state, pending counts/kinds, held state and last successful transmission separately, and keep copies stale until replacement sync completes. It SHALL restore the existing capability-gated general controls and playback view, with no writes for read-only callers. It SHALL take the Pixoo's mode and base from the device's advertised Hub mode and `pixoo-display/2.1`, with no Monitor/Media mapping of its own.

#### Scenario: Several owners and an unavailable owner
- **WHEN** several modules declare device records and one owner's sync fails
- **THEN** the dashboard shows each owner's records separately, identifies the unavailable owner, retains its stale records and disables its controls without treating its missing reply as device removal

#### Scenario: One guarded general control
- **WHEN** a person deliberately changes a supported device control
- **THEN** one authenticated action-route request carries its target, fresh request ID and the current configuration revision and generation; unsupported values and stale records are refused locally with nothing sent

#### Scenario: Mode and content stay explicit
- **WHEN** Nanoleaf is outside Free or the Pixoo reports Work
- **THEN** content controls are disabled with the mode named, a start the module refuses is shown as `invalid-state` from its outcome without changing mode, and supported power, brightness and Hub-mode controls remain available under the module's policy

#### Scenario: Capability-gated moments and playback
- **WHEN** a module advertises manual moments or playback controls
- **THEN** the existing manual card sends the selected action through the action route using that family's declared payload, and unavailable playback is never presented as nothing playing
