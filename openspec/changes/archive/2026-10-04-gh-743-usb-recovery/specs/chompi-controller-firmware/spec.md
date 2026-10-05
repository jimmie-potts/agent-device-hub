## ADDED Requirements

### Requirement: USB reconnection without a power cycle
The firmware SHALL restart its USB device (detach, re-initialize and re-attach) once the device has been unconfigured by the host for 3 s, and SHALL retry every 5 s while it stays unconfigured, so the host enumerates it again after an unplug and replug, a cable bump or a brief drop of the data lines. It MUST NOT restart a configured device, including one suspended under a sleeping host, and MUST NOT depend on the charger's input-power reading for this decision. Each new enumeration SHALL start a new epoch as on any enumeration.

#### Scenario: Unplug and replug while running
- **WHEN** the USB cable is unplugged for a few seconds and plugged back in while the controller keeps running on battery
- **THEN** the host enumerates the controller again without a power cycle and the bridge reconnects with a new epoch

#### Scenario: Sleeping host
- **WHEN** the host suspends the bus while the device stays configured
- **THEN** the firmware does not restart its USB device
