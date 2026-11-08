## MODIFIED Requirements

### Requirement: Hub-mode table

The package SHALL publish one fixed table from the Hub's mode to each participating device kind's native mode, in its README and as `HUB_MODE_TABLE` with `nativeMode(kind, mode)`. Nanoleaf and Pixoo SHALL each map Work, Quiet and Free one to one. LIFX, Tidbyt and playback SHALL NOT take part. The table SHALL map only from the Hub's mode to a native mode, and a device's native mode SHALL NOT be stored as the Hub's mode.

#### Scenario: Each participating device kind
- **WHEN** each Hub mode is mapped for Nanoleaf and for Pixoo
- **THEN** each result equals the Hub mode, is a native mode the device advertises, and the README table equals the code's

#### Scenario: Devices outside the Hub mode
- **WHEN** a Hub mode is mapped for LIFX, Tidbyt or playback
- **THEN** there is no native mode

#### Scenario: A native mode is never the Hub's mode
- **WHEN** a value other than `work`, `free` or `quiet` is stored in the Hub's `mode` record, or `monitor` is requested from a Pixoo as a native mode
- **THEN** the record is refused with `invalid-message` and the command is unsupported
