## ADDED Requirements

### Requirement: USB reconnection without a power cycle
The firmware SHALL restart its USB device (detach, re-initialize and re-attach) once the device has been neither configured nor addressed by the host for 3 s, and SHALL retry every 5 s while it stays that way, so the host enumerates it again after an unplug and replug, a cable bump or a brief drop of the data lines. A device the host addressed but left unconfigured, which may be healthy (a disabled device, a failed or slow driver install, SET_CONFIGURATION 0) or stuck mid-enumeration, SHALL wait 10 s and then back off, doubling the wait up to 320 s between restarts until a configuration resets it. The firmware MUST NOT restart a configured device, including one suspended under a sleeping host, MUST NOT cut short the charger's port detection with a restart, and MUST NOT depend on the charger's input-power reading for this decision. Each new enumeration SHALL start a new epoch as on any enumeration.

#### Scenario: Unplug and replug while running
- **WHEN** the USB cable is unplugged for a few seconds and plugged back in while the controller keeps running on battery
- **THEN** the host enumerates the controller again without a power cycle and the bridge reconnects with a new epoch

#### Scenario: Host leaves the device unconfigured on purpose
- **WHEN** the host addresses the device but does not configure it, for example because the device is disabled in Windows
- **THEN** the firmware restarts its USB device only after 10 s and then at doubling intervals up to 320 s, never in a tight loop

#### Scenario: Sleeping host
- **WHEN** the host suspends the bus while the device stays configured
- **THEN** the firmware does not restart its USB device
