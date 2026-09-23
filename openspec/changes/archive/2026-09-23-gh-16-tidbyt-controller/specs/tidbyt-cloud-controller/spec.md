## ADDED Requirements

### Requirement: Pure 64×32 WebP rendering boundary
The Tidbyt controller SHALL render a display frame through a pure function that accepts only a 64×32 RGB frame and returns lossless WebP bytes. The renderer MUST NOT depend on backend identity, credentials, capabilities, configuration, clocks or I/O. It MUST reject any frame whose dimensions, encoding or byte length differ from the profile without producing an image.

#### Scenario: Valid frame
- **WHEN** a 64×32 frame with 6144 RGB bytes is rendered
- **THEN** the result is a deterministic RIFF/WEBP VP8L image that an independent decoder reads back as exactly those pixels, fully opaque

#### Scenario: Invalid frame
- **WHEN** a frame has other dimensions, a short or long buffer, a non-canonical or wrong-length base64 payload, or an unknown encoding
- **THEN** rendering fails with an invalid-frame result and no image or write is produced

#### Scenario: Backend-independent renderer
- **WHEN** the renderer module and its imports are inspected
- **THEN** they reference no connection, credential, configuration or controller module

### Requirement: Tidbyt cloud connection
The controller SHALL send frames to the official Tidbyt cloud as background pushes to one operator-configured installation. The cloud device ID and API key MUST come from a private configuration file outside Git and never from arguments. The connection MUST NOT expose the key, the cloud device ID or raw response bodies in results, errors or snapshots, and it MUST classify each result without retrying.

#### Scenario: Background push
- **WHEN** a frame is pushed
- **THEN** exactly one `POST /v0/devices/{device}/push` is made with a bearer key, the WebP as base64, the configured installation ID and `background:true`

#### Scenario: Authentication failure
- **WHEN** the cloud answers 401, 403 or a 500 that reports a missing identity
- **THEN** the write fails as unauthenticated or forbidden with no prior effects, and later writes fail without a network call until the operator reconfigures credentials

#### Scenario: Rate limit
- **WHEN** the cloud answers 429 with or without `Retry-After`
- **THEN** that write fails with `capacity`, and queued writes wait until the bounded hold expires instead of failing or being sent

#### Scenario: Private configuration file
- **WHEN** credentials are loaded from a file that is group- or world-readable, missing a value, or holding an invalid installation ID
- **THEN** loading fails with a code that includes no file contents

### Requirement: Serialized display queue
The controller SHALL serialize every write for its configured device through one FIFO queue that uses controller v1 request tickets, configuration revisions and generations. It MUST reject requests for another controller or device before reserving an identity, and it MUST bound the queue, in-flight work, request body and retained receipts. A structurally identical duplicate MUST return the original receipt or join the in-flight write. A changed body under the same identity MUST return `request-conflict`. The controller MUST NOT automatically replay an ambiguous write.

#### Scenario: Configured-target validation
- **WHEN** a request names an unregistered controller or device, or is malformed
- **THEN** it is rejected before reservation and no push occurs

#### Scenario: Bounded admission
- **WHEN** a request arrives with the queue full or its body over the limit
- **THEN** it returns `capacity` without consuming the request identity

#### Scenario: Duplicate and conflicting identities
- **WHEN** a request is resubmitted with the same body, including reordered keys, while queued or after completion, or resubmitted with a different body
- **THEN** the same body joins or replays the original receipt with one push in total, and a different body returns `request-conflict`

#### Scenario: Overlapping writes
- **WHEN** several display requests are admitted while a push is in flight
- **THEN** pushes happen one at a time in admission order

#### Scenario: Cancellation
- **WHEN** pending work is cancelled while one push is in flight
- **THEN** queued entries return `cancelled` with `stale-generation` and no push, and the in-flight push reports its own result

#### Scenario: Uncertain send
- **WHEN** a push times out, loses its response or gets a server error after dispatch
- **THEN** the receipt is `uncertain` with possible prior effects, and neither the controller nor a duplicate submission sends it again

#### Scenario: Unsupported controller v1 commands
- **WHEN** a schema-valid controller v1 command such as `power.set` is submitted
- **THEN** its identity is reserved and it is retained as failed `unsupported-capability`

### Requirement: Separate outcomes and evidence
The controller SHALL report queued, sent, failed, uncertain and cancelled outcomes as schema-valid controller v1 receipts, separately from cloud installation evidence and its age. Visible-device evidence MUST remain unknown. The controller MUST publish only capabilities it supports and MUST NOT fabricate observations from service health or a successful send.

#### Scenario: Snapshot after a successful send
- **WHEN** a push succeeds
- **THEN** the schema-valid controller snapshot records the last successful send while observation stays unknown, every controller v1 capability is unsupported, and the Tidbyt section reports visible evidence as unknown

#### Scenario: Reconnect and stale evidence
- **WHEN** the controller refreshes after a transport failure, and later a read fails
- **THEN** the refresh reads installation presence without resubmitting any command, the evidence age grows from its own read time, and a failed read marks health unavailable while keeping the older evidence and its age
