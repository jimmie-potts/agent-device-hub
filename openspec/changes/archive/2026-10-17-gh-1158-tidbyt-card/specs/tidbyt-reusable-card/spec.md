## Purpose

Give the owner a consistent reusable Tidbyt card that explains existing cloud evidence without suggesting unsupported controls or physical display observation.

## ADDED Requirements

### Requirement: One card with stationary illustrative artwork

The dashboard SHALL reuse one exported Tidbyt card on Home, its device page and a declared Tidbyt page. Status and Content tabs SHALL change the information face while retaining the same clearly labelled wooden 64×32 illustration. It SHALL offer neither Activity nor format switching. This satisfies issue 1158 AC1.

#### Scenario: Navigate and switch information
- **WHEN** the owner opens each supported surface and switches tabs rapidly or by keyboard
- **THEN** the same card is available, its artwork remains mounted, and selected-tab and panel associations stay correct

### Requirement: Cloud evidence is distinct from physical observation

The card SHALL label existing owner availability as cloud availability and lastTransmission as cloud acceptance, with its timestamp. Missing evidence SHALL remain unknown; saved evidence after loss of sync SHALL be visibly stale. Content SHALL explain automatic agent status and optional now playing without asserting configured installations or what the device currently shows. This satisfies AC2.

#### Scenario: Known and unknown transmission
- **WHEN** the owned device record has a known cloud transmission or no transmission evidence
- **THEN** the card shows the cloud acceptance time or explicitly reports that no transmission is recorded, never a physical display result

#### Scenario: Cloud failure and stale copy
- **WHEN** cloud availability becomes unavailable or the owner's copy stops following
- **THEN** the first is shown as cloud unavailability and the second as stale saved evidence, with neither described as a verified device display

### Requirement: Inspection is accessible and causes no command

Read-only and control-authorized callers SHALL be able to inspect the card. Tabs SHALL support arrow, Home and End keys, narrow screens and reduced motion. Mounting, navigation, retry and reconnect SHALL issue no command, polling or second connection. Brightness, power, tile selection and push/removal controls SHALL be absent. This satisfies AC3.

#### Scenario: Read-only interaction
- **WHEN** a read-scoped owner navigates all surfaces and uses the tabs on a 390px screen with reduced motion
- **THEN** information remains readable and accessible, the artwork remains visible and no device command is attempted

### Requirement: Owner sync has a bounded page lifetime

The card SHALL consume only the Tidbyt owner's device copy through the existing shell participant. Replacement sync SHALL replace membership before presenting it as current. Failed or disconnected copies SHALL not become current merely because the shell reconnects. Unmount SHALL close active and late-arriving copies and suppress their later updates. An explicit retry SHALL perform only a read. This satisfies AC4.

#### Scenario: Reconnect before owner sync
- **WHEN** the shell reconnects while the owner's replacement sync is held
- **THEN** saved information stays stale until that sync completes, then its replacement membership becomes current

#### Scenario: Removal, retry and late copy
- **WHEN** a device is removed from a replacement snapshot, a sync fails, or its result arrives after unmount
- **THEN** removed membership is not retained as current, failed reads can be explicitly retried without commands and the late copy is closed
