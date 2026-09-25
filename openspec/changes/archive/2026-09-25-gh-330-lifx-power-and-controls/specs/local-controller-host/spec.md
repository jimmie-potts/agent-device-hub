## MODIFIED Requirements

### Requirement: One writer per device

The host SHALL be the only writer for its devices while it runs. It SHALL start the Tidbyt runner in-process, which holds the existing cloud-device lease and runs the status and optional now-playing publishers through the one Tidbyt queue. It SHALL hold one OS-released lease per configured bulb address for its lifetime. It SHALL NOT send status to a bulb or change a bulb except for an explicit admitted command, so a manual change in the LIFX app stays until the next explicit command. Its only other bulb traffic SHALL be the bounded read-only reads of the on-demand bulb reads requirement.

#### Scenario: Second writer
- **WHEN** a Tidbyt runner or another host already holds the lease for the configured Tidbyt device or any configured bulb address
- **THEN** this host fails to start before listening or sending any device request, and releases every lease it had taken

#### Scenario: Manual LIFX change
- **WHEN** the bulb is changed in the LIFX app and no command arrives
- **THEN** the host sends no write to the bulb, and a later on-demand read reports the manual state as an observation with its age without changing it

## ADDED Requirements

### Requirement: On-demand bulb reads

When a qualified LIFX bulb's controller v1 or lighting snapshot is read and the bulb has no observation or its observation is at least 30 s old, the host SHALL queue one read-only LightGet through that bulb's queue, unless it already started a read for that bulb in the last 30 s. The snapshot SHALL answer immediately from the current observation. A read SHALL NOT reserve a request identity or change the configuration revision or generation. A failed read SHALL keep the previous observation. The host SHALL NOT read an unqualified bulb and SHALL send no read while nothing reads its snapshots.

#### Scenario: Page load
- **WHEN** B.U.N.N.Y. opens a qualified bulb that has never been read
- **THEN** the first snapshot answers with an unknown observation and queues exactly one LightGet, and a snapshot read after it settles reports the observed power and brightness with their age

#### Scenario: Repeated reads
- **WHEN** snapshots are read repeatedly within 30 s of a read, or while a read is still queued
- **THEN** no further bulb traffic is sent, and after 30 s one more read is allowed

#### Scenario: Unqualified bulb and no readers
- **WHEN** an unqualified bulb's snapshot is read, or no snapshot is read at all
- **THEN** the host sends no traffic to that bulb
