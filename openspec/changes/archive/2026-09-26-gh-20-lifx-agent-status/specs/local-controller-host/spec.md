## ADDED Requirements

### Requirement: Automatic LIFX status painting

The host's private configuration MAY name a `lifx.status` hub-feed block (`hubUrl`, `ownerId`, `tokenFile`, validated like the Tidbyt runner's own hub connection) and, per bulb, an optional `status` block (`brightnessCapPercent`, `quietCapPercent`, both integers 1-100, defaulting to 50 and 20). When both the host-level feed and a qualified bulb's own `status` block are present, the host SHALL start one status publisher for that bulb alongside the Tidbyt runner, reading the shared agent-state owner through the same `HubStatusFeed` class the Tidbyt runner uses, and SHALL stop it on shutdown before gracefully closing the LIFX controller and releasing bulb leases. The host SHALL construct its `LifxController` with a `modeStateRoot` derived from its own bulb-lease root (`<leaseRoot>/modes`) so that qualified bulbs advertise modes wherever the host already holds a writer lease for them, without relying on any package-level default. A qualified bulb without a `status` block SHALL still advertise `modes` and accept `mode.set` but SHALL NOT be painted. The host SHALL NOT start a publisher when the `lifx.status` feed block is absent, regardless of any bulb's own `status` block.

#### Scenario: Opted-in qualified bulb paints
- **WHEN** the host starts with a `lifx.status` feed block and a qualified bulb's own `status` block, and that bulb's mode is Work
- **THEN** the host paints the current shared status on that bulb through the controller's internal paint operation

#### Scenario: Unconfigured qualified bulb never paints
- **WHEN** the host starts with a `lifx.status` feed block but a qualified bulb has no `status` block
- **THEN** that bulb still advertises `modes` and accepts `mode.set`, but the host never paints it

#### Scenario: No feed block means no painting anywhere
- **WHEN** the host starts without a `lifx.status` feed block
- **THEN** no bulb is painted regardless of its own `status` block

#### Scenario: Shutdown stops the publisher before releasing leases
- **WHEN** the host stops while a status publisher is running
- **THEN** the publisher is stopped before its bulb's writer lease is released, and the LIFX controller's graceful shutdown lets any in-flight paint finish rather than aborting it

#### Scenario: The mode file lands under the supplied lease root
- **WHEN** the host starts with a lease root and a client sends `mode.set` for a qualified bulb
- **THEN** the persisted mode file is written under that lease root's `modes` subdirectory, not any package-level default
