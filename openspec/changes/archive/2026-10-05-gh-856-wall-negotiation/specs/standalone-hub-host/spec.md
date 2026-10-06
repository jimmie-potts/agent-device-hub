## MODIFIED Requirements

### Requirement: Controller snapshot version negotiation
The host's per-device controller client SHALL read a controller's snapshot with `apiVersion=1.1` when asked for a 1.1 read, and SHALL validate an answer that declares `apiVersion` 1.1 against `snapshotV1_1` and an answer that declares 1.0 against the 1.0 snapshot schema, in each case with the configured controller and device identity. An `invalid-request` refusal of the versioned read SHALL mean the controller serves only 1.0, whether it arrives as the contract's 400 or as the 404 `{"failure":{"code":"invalid-request"}}` the Nanoleaf controller gives for an unknown read parameter: the client SHALL read again without the parameter and SHALL remember a `1.0-only` verdict for the controller epoch of that answer. A 1.0 answer to the versioned read SHALL produce the same verdict without a second read. While a verdict holds, the client SHALL read without the parameter and SHALL NOT probe again as long as the answer carries the same controller epoch. It SHALL probe again when the answer carries a different epoch, and a new client SHALL hold no verdict. That refusal SHALL NOT mark the controller unavailable. A timeout, a 5xx answer, a malformed answer, any other 404 such as `unknown-device`, or any other failure SHALL NOT create, change or clear a verdict. Reads without a version request SHALL send no version parameter. Negotiation SHALL run inside the client's single bounded slot per controller and SHALL send no command.

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

#### Scenario: Controller that refuses the versioned read as an unknown route
- **WHEN** the client reads at 1.1 a controller that answers the versioned read with 404 `invalid-request`
- **THEN** it makes exactly one further read without the parameter, returns that 1.0 snapshot, records a `1.0-only` verdict and keeps the controller's health ready

#### Scenario: Unknown device on the versioned read
- **WHEN** the controller answers the versioned read with 404 `unknown-device`
- **THEN** the read fails with `unknown-device` and no verdict is recorded
