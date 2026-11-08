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

### Requirement: General device commands

The profile SHALL define one command family for each kind of controller contract v1's closed command union: `power-set` (`on`), `brightness-set` (`percent`, 0 to 100), `scene-activate` (`sceneId`), `zone-power-set` (`zoneId`, `on`), `media-start` (`playlistId`), `media-control` (`action`) and `device-mode-set` (a native `mode`). `media-start` and `media-control` SHALL keep their optional `requireMode` member, a native mode added by #1276, because removing a member from a closed 2.0 minor is not additive; no module SHALL admit by it: the Pixoo, the only module that ever read it, SHALL refuse a command that carries it with `invalid-request` before any device write (ADR 0014), and the core SHALL send none. Each SHALL be sent as `org.bunny.<entity>.<verb>.requested`, whose verb is the family's last word, and SHALL carry a `requestId` and optional `expectedConfigurationRevision` and `expectedGeneration` guards. The dashboard and MCP SHALL send both guards on a person's command, copied from the device record they showed; a module SHALL refuse a stale guard with `revision-conflict` before changing anything; and the Hub-mode fan-out SHALL send none. The envelope subject of every general command and of `moment-play` SHALL name the target device by its device ID, a routing ID unique across modules, and no payload SHALL name a device, controller, address, credential or raw protocol. Their replies and outcomes SHALL use the profile's reply and outcome payloads. `registerDeviceFamilies` SHALL register the device families after the core families. `commandSupported(capabilities, command)` SHALL report a command, `moment-play` included, as supported only when its capability is supported and the named scene, zone, playlist, action, native mode or mood is advertised, and a moment fits the device's maximum duration.

#### Scenario: Each command reaches a device that supports it
- **WHEN** each general command fixture is checked against its target device's capabilities
- **THEN** it is valid and supported, and each command family has a valid reply and outcome

#### Scenario: Unsupported commands
- **WHEN** a command names an unsupported capability, an unlisted scene, zone, playlist or action, a native mode the device does not advertise, or a moment with an undeclared mood or an over-long duration
- **THEN** `commandSupported` returns false, so the module refuses it with `unsupported-capability`

#### Scenario: Unroutable subjects
- **WHEN** any general command, a `moment-play` request or a `playback-control` request goes to a subject with a dot, an uppercase letter, an underscore or more than 128 characters
- **THEN** it is refused with `invalid-message` and a detail naming the envelope subject

#### Scenario: Malformed commands
- **WHEN** a command names a device, a controller or a raw protocol, misses its request ID, goes to a subject that is not a device ID, misses its value, sets a brightness over 100 or a fractional one, names a playlist by a path, uses a media action outside the union, a 1.x mode spelling, a 1.x ticket as its request ID, or another kind or type
- **THEN** it is refused with `invalid-message` and a detail naming where
