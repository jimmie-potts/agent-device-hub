## ADDED Requirements

### Requirement: Controller snapshot version negotiation
The host's per-device controller client SHALL read a controller's snapshot with `apiVersion=1.1` when asked for a 1.1 read, and SHALL validate an answer that declares `apiVersion` 1.1 against `snapshotV1_1` and an answer that declares 1.0 against the 1.0 snapshot schema, in each case with the configured controller and device identity. A 400 `invalid-request` answer to the versioned read SHALL mean the controller serves only 1.0: the client SHALL read again without the parameter and SHALL remember a `1.0-only` verdict for the controller epoch of that answer. A 1.0 answer to the versioned read SHALL produce the same verdict without a second read. While a verdict holds, the client SHALL read without the parameter and SHALL NOT probe again as long as the answer carries the same controller epoch. It SHALL probe again when the answer carries a different epoch, and a new client SHALL hold no verdict. A timeout, a 5xx answer, a malformed answer or any other failure SHALL NOT create, change or clear a verdict. Reads without a version request SHALL send no version parameter. Negotiation SHALL run inside the client's single bounded slot per controller and SHALL send no command.

#### Scenario: 1.1 controller
- **WHEN** the client reads a controller that serves 1.1 at 1.1
- **THEN** it returns the snapshot validated against `snapshotV1_1` after one read

#### Scenario: 1.0-only controller
- **WHEN** the client reads at 1.1 a controller that answers the versioned read with `invalid-request`
- **THEN** it makes exactly one further read without the parameter, returns that 1.0 snapshot and records a `1.0-only` verdict, and later reads in the same epoch make no versioned read

#### Scenario: Controller restarts serving 1.1
- **WHEN** a controller with a `1.0-only` verdict restarts with a new epoch and now serves 1.1
- **THEN** the next 1.1 read returns the 1.1 snapshot and clears the verdict

#### Scenario: Transient failure
- **WHEN** a versioned or unversioned read times out or the controller answers 5xx
- **THEN** the read fails as unavailable and the verdict is unchanged, so a failed probe is repeated on the next read

#### Scenario: No commands
- **WHEN** snapshot reads, negotiation, reconnects or dashboard polls run against a 1.1 or 1.0-only controller
- **THEN** the controller receives no command request

### Requirement: Versioned controller snapshot route
`GET /api/controllers/v1/<alias>/snapshot` SHALL return the 1.0 snapshot shape unless the request carries `apiVersion=1.1`, and SHALL send no version parameter to the controller for that default read. With `apiVersion=1.1` it SHALL return the negotiated snapshot: the 1.1 snapshot, including `capabilities.moments` and `state.moment`, for a controller that serves 1.1, and the 1.0 snapshot for a 1.0-only controller. `apiVersion=1.0` SHALL behave as the default. Any other `apiVersion` value, a repeated `apiVersion` or another query parameter SHALL answer 400 `invalid-request` before the controller is contacted, after the same authorization as other controller routes. The route SHALL keep its existing authorization, read scope and errors.

#### Scenario: Default readers
- **WHEN** a dashboard or other reader reads the snapshot route without a parameter for a 1.1 controller or a 1.0-only controller
- **THEN** it receives the closed 1.0 shape and the controller sees no version parameter

#### Scenario: Opt-in 1.1
- **WHEN** a reader adds `apiVersion=1.1`
- **THEN** it receives `capabilities.moments` and `state.moment` from a 1.1 controller, and a 1.0 snapshot from a 1.0-only controller

#### Scenario: Strict parameters
- **WHEN** the request has `apiVersion=1.2`, an empty value, two `apiVersion` values or an extra parameter
- **THEN** the hub answers 400 `invalid-request` and sends nothing to the controller
