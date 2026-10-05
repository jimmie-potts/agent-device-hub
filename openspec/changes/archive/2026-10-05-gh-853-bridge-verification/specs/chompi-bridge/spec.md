## ADDED Requirements

### Requirement: Simulated desktop only by explicit flag
`chompi-bridge run` SHALL use the simulated desktop adapter only when given `--desktop sim` together with the routing flags; any other value, or the flag without routing, SHALL be a usage error that opens nothing. Without the flag the bridge SHALL NOT import the simulation modules and SHALL use the platform OS adapter as before. The simulated desktop SHALL implement OS adapter interface version 3 with the same observable behavior the router's adapter tests rely on, SHALL be branded as simulated, and SHALL hold only synthetic titles and text. A caller of the CLI in the same process MAY receive the simulated controller and desktop the flags created before the router starts; without those flags it receives nothing.

#### Scenario: No flag
- **WHEN** the bridge CLI and package entry are loaded and `run` is given without `--desktop sim`
- **THEN** no simulation module is imported and the platform adapter is used

#### Scenario: Flag without routing
- **WHEN** `run --desktop sim` is given without the routing flags, or `--desktop` names anything but `sim`
- **THEN** the CLI exits with usage code 2 and creates no transport

#### Scenario: Simulated run
- **WHEN** `run --simulate --desktop sim` runs with the routing flags against a synthetic feed
- **THEN** a slot press focuses the task in the simulated desktop, and neither the HID transport nor the platform adapter is created

#### Scenario: Shared adapter contract
- **WHEN** the adapter contract runs against the router tests' fake adapter and the simulated desktop
- **THEN** both meet the same expectations for links, composer focus, cards, scrolling, archives and held keys
