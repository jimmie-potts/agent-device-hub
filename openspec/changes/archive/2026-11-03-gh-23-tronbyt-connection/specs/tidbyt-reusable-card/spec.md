## MODIFIED Requirements

### Requirement: Cloud evidence is distinct from physical observation

The card SHALL label existing owner availability as the selected backend's availability and lastTransmission as its acceptance, with its timestamp: the cloud's by default, and the server's when the record declares a Tronbyt server's controls. It offers no control on either. Missing evidence SHALL remain unknown; saved evidence after loss of sync SHALL be visibly stale. Content SHALL explain automatic agent status and optional now playing without asserting configured installations or what the device currently shows. This satisfies AC2.

#### Scenario: Known and unknown transmission
- **WHEN** the owned device record has a known cloud transmission or no transmission evidence
- **THEN** the card shows the cloud acceptance time or explicitly reports that no transmission is recorded, never a physical display result

#### Scenario: Cloud failure and stale copy
- **WHEN** cloud availability becomes unavailable or the owner's copy stops following
- **THEN** the first is shown as cloud unavailability and the second as stale saved evidence, with neither described as a verified device display
