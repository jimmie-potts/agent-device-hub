## ADDED Requirements

### Requirement: General controls from named runtime owners
The dashboard SHALL sync device records from each declared owner and operations from the core through its existing SDK participant. It SHALL show desired state, observed state, pending counts/kinds, held state and last successful transmission separately, and keep copies stale until replacement sync completes. It SHALL restore the existing capability-gated general controls and playback view, with no writes for read-only callers.

#### Scenario: Several owners and an unavailable owner
- **WHEN** several modules declare device records and one owner's sync fails
- **THEN** the dashboard shows each owner's records separately, identifies the unavailable owner, retains its stale records and disables its controls without treating its missing reply as device removal

#### Scenario: One guarded general control
- **WHEN** a person deliberately changes a supported device control
- **THEN** one authenticated action-route request carries its target, fresh request ID and the current configuration revision and generation; unsupported values and stale records are refused locally with nothing sent

#### Scenario: Mode and content stay explicit
- **WHEN** Nanoleaf is outside Free or Pixoo is outside Media
- **THEN** content controls refuse without changing mode, while supported power, brightness and explicit native-mode controls remain available under the module's policy

#### Scenario: Capability-gated moments and playback
- **WHEN** a module advertises manual moments or playback controls
- **THEN** the existing manual card sends the selected action through the action route using that family's declared payload, and unavailable playback is never presented as nothing playing

### Requirement: Tracked control states and no replay
The dashboard SHALL distinguish requested, accepted and completed actions using core operation records. It SHALL retain refusals, failures and uncertain results with their effect evidence and request identity. A lost reply or reconnect SHALL NOT cause a write to retry or replay.

#### Scenario: Accepted before completion
- **WHEN** the action route accepts a device command while its module is still working
- **THEN** the card shows accepted and remains locked until operation evidence settles it, and a transmitted success says physical effect was not observed

#### Scenario: Uncertain across reload and refresh
- **WHEN** a command has an uncertain result and the page reloads, reconnects or explicitly refreshes
- **THEN** ordinary controls stay locked, no command is replayed, and a definitive operation outcome can release the lock; a held device remains visibly held until its existing explicit guarded recovery or definitive outcome releases it

#### Scenario: Refused before changing state
- **WHEN** the core refuses a command with a registry error code
- **THEN** the card shows that code and says the request was refused without changing state, distinct from a local refusal where nothing was sent

### Requirement: Declared pages inside the shell
The dashboard SHALL show navigation only for pages declared by current module metadata and open them inside the existing shell. The destination SHALL be the exact same-origin module page path, with no installed service or private-file fallback.

#### Scenario: Bookmark and keyboard navigation
- **WHEN** a person opens a declared module hash bookmark or activates its navigation link with the keyboard
- **THEN** the existing browser sign-in succeeds and the declared page appears inside the shell, without sending a device command

#### Scenario: Undeclared or external page
- **WHEN** a hash names an undeclared page or metadata contains an external or malformed path
- **THEN** the dashboard opens no such destination and offers no navigation to it

### Requirement: Small running-build identity
Connections SHALL display the runtime's frozen build revision, package version, build time and dirty status when available, with unknown values stated honestly. The authenticated read SHALL reveal no settings, host paths or credentials.

#### Scenario: A disposable preview build
- **WHEN** the existing disposable runtime serves the dashboard and Connections is opened
- **THEN** the page identifies the serving build without querying Git per request or claiming installation or device acceptance
