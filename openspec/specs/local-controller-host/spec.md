# local-controller-host Specification

## Purpose
Define the local controller host from [Hub #289](https://github.com/jimmie-potts/agent-device-hub/issues/289): one loopback process that owns the in-process Tidbyt and LIFX controllers and serves controller v1, plus the LIFX lighting profile, so the hub can route to them like any other controller service.

## Requirements

### Requirement: Private explicit configuration

The host SHALL start only from an absolute, owner-owned, mode-600 regular configuration file outside any Git checkout. The file names the loopback port, one to sixteen machine credentials, and at least one of the path to an existing private Tidbyt runner configuration and a LIFX controller with one to thirty-two explicitly addressed bulbs. Each credential SHALL carry an ID, the SHA-256 digest of its bearer token, its scopes (`read`, `control`) and the device IDs it may use. Device IDs SHALL be unique across Tidbyt and LIFX. Unknown fields, symlinks, oversized files and invalid values SHALL fail startup with a generic error that repeats no file contents. The host SHALL NOT discover or scan for devices. Snapshots, receipts and errors SHALL NOT contain bulb addresses, Tidbyt credentials, tokens or file paths.

#### Scenario: Unsafe configuration
- **WHEN** the configuration file or a file it references is group-readable, a symlink, inside a Git checkout, oversized or has an unknown field, a duplicate device ID or no device
- **THEN** startup fails before any listener, lease, feed or device request, without echoing the file's contents

#### Scenario: Private values stay private
- **WHEN** a client reads any snapshot or receives any receipt or error
- **THEN** the response contains configured neutral IDs only, never a bulb address, token, Tidbyt key or path

### Requirement: Authenticated bounded machine API

The host SHALL listen only on `127.0.0.1` and SHALL authenticate every request with a configured bearer credential before reading its body or looking up replay. A request whose `Host` is not the listener's own origin, or that carries a browser `Origin` or a cross-site `Sec-Fetch-Site`, SHALL be forbidden. Reads need `read` scope and commands need `control` scope for the addressed device. The host SHALL bound request bodies to 64 KiB, JSON depth to 32 and concurrent requests to 32, and apply header and request timeouts. It SHALL use the contract's HTTP mapping: 400 invalid, 401 unauthenticated, 403 forbidden, 404 unknown device, 409 conflicts and stale generation, 410 expired identity, 422 unsupported operation, 429 capacity.

#### Scenario: Missing or wrong credential
- **WHEN** a request has no bearer token, an unknown token, a credential without the needed scope, or a credential that does not list the addressed device
- **THEN** the host answers 401 or 403 before reading the body, and no request identity is reserved and nothing is sent to a device

#### Scenario: Browser or rebinding request
- **WHEN** a request carries an `Origin` header, a cross-site fetch-metadata header or a `Host` other than the listener's loopback origin
- **THEN** the host answers 403 without admitting anything

#### Scenario: Resource bounds
- **WHEN** a body exceeds 64 KiB or 32 requests are already in flight
- **THEN** the host answers 429 before reserving a request identity

### Requirement: Controller v1 for each configured device

The host SHALL serve `GET /controller/v1/snapshot?deviceId=<id>` and `POST /controller/v1/commands` for every configured Tidbyt and LIFX device, using each owning controller's request tickets, configuration revisions, generations, replay cache and receipts unchanged. The command route SHALL accept only strict controller v1 requests. An admission rejection that reserves no identity SHALL answer `{failure:{code}}`; a reserved rejection SHALL answer its retained receipt with the mapped status. An admitted command SHALL answer its terminal receipt when it settles within one second, and otherwise its `queued` receipt with status 202. The Tidbyt device SHALL declare every controller v1 capability unsupported, so every Tidbyt command is retained as `unsupported-capability`. A qualified LIFX bulb SHALL declare power and brightness.

#### Scenario: Tidbyt status only
- **WHEN** an authorized client sends a valid Tidbyt `power.set` or `brightness.set` with the current guards
- **THEN** the host answers 422 with a schema-valid receipt carrying `unsupported-capability` and no prior effects, and nothing is pushed to the cloud

#### Scenario: LIFX brightness
- **WHEN** an authorized client sends a LIFX `brightness.set` with the snapshot's request ID, configuration revision and generation
- **THEN** the bulb's queue reads the light and sets the brightness, and the host answers a schema-valid terminal receipt that reports transmission only

#### Scenario: Guards and replay
- **WHEN** a command repeats an earlier request ID with the same body, reuses it with a different body, uses a stale configuration revision, or uses an older or future sequence
- **THEN** the host answers the original receipt without another device write, `request-conflict`, a retained `revision-conflict` receipt, `request-expired` or `request-order` respectively

#### Scenario: Frames are not a v1 command
- **WHEN** a client posts a Tidbyt display or removal request to the v1 command route
- **THEN** the host answers 400 `invalid-request` and the Tidbyt queue receives nothing

### Requirement: LIFX lighting profile route

The host SHALL serve `GET /controller/lifx-light/v1/snapshot?deviceId=<id>` and `POST /controller/lifx-light/v1/commands` for LIFX bulbs only. The snapshot SHALL be the LIFX controller's profile, controller v1 snapshot and lighting section. The command route SHALL accept only strict `lifx-light` 1.0.0 color and temperature requests, which share the bulb's single queue and request identity namespace with its controller v1 commands. A request for a Tidbyt device on this route SHALL answer 404 `unknown-device`.

#### Scenario: Color change
- **WHEN** an authorized client sends `lifx.color.set` with integer hue 0 to 360 and saturation 0 to 100 and the current guards
- **THEN** the bulb's queue applies it and the host answers a schema-valid controller v1 receipt, and the next lighting snapshot shows the request retired from `lighting.pending`

#### Scenario: Invalid profile request
- **WHEN** a profile request names another profile version, an out-of-range or fractional value, an extra field or a v1 command
- **THEN** the host answers 400 `invalid-request` and no identity is reserved

### Requirement: One writer per device

The host SHALL be the only writer for its devices while it runs. It SHALL start the Tidbyt runner in-process, which holds the existing cloud-device lease and runs the status and optional now-playing publishers through the one Tidbyt queue. It SHALL hold one OS-released lease per configured bulb address for its lifetime. It SHALL NOT send status to a bulb or change a bulb except for an explicit admitted command, so a manual change in the LIFX app stays until the next explicit command. Its only other bulb traffic SHALL be the bounded read-only reads of the on-demand bulb reads requirement.

#### Scenario: Second writer
- **WHEN** a Tidbyt runner or another host already holds the lease for the configured Tidbyt device or any configured bulb address
- **THEN** this host fails to start before listening or sending any device request, and releases every lease it had taken

#### Scenario: Manual LIFX change
- **WHEN** the bulb is changed in the LIFX app and no command arrives
- **THEN** the host sends no write to the bulb, and a later on-demand read reports the manual state as an observation with its age without changing it

### Requirement: Bounded shutdown

SIGINT and SIGTERM SHALL stop accepting requests, stop the Tidbyt publishers, cancel queued Tidbyt and LIFX work, settle in-flight work, release every lease and exit. Shutdown SHALL leave the Tidbyt installations and bulb states as they are. Restart SHALL start from fresh request identities and replay nothing.

#### Scenario: Stop and restart
- **WHEN** the host stops and starts again
- **THEN** the leases are released and retaken, snapshots carry new controller epochs, and no earlier command is resent

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
