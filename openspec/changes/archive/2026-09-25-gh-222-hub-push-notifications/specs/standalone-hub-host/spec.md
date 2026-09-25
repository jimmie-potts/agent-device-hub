## MODIFIED Requirements

### Requirement: Authenticated bounded shared transport
The host SHALL serve authenticated loopback sessions, ingestion, commands and revisioned changes compatible with Pixoo's selected-source protocol. Authorization SHALL precede replay and preserve privacy, Host/Origin protections and finite resource limits. Revisioned changes SHALL be pushed to open streams as each revision commits, from any admission path, in addition to a periodic timer that covers heartbeats, the per-stream auth recheck and changes that do not commit. A burst of commits SHALL coalesce into at most one flush per open stream. A slow, paused or stalled stream MUST NOT delay ingest, other commits or another stream.

#### Scenario: Unauthorized and oversized requests
- **WHEN** a credential is absent, revoked, out of scope or a request exceeds the declared limits
- **THEN** it is rejected without state or device effects and without echoing secrets or private payloads

#### Scenario: Labels and acknowledgment through selected owner
- **WHEN** a remote Pixoo facade reads or submits an authorized label or notice acknowledgment
- **THEN** the selected shared owner handles it, while no local reducer or second owner starts

#### Scenario: Replay and slow consumers
- **WHEN** a command ticket is repeated or a consumer reconnects after overflow
- **THEN** identical commands retain their result, conflicting tickets reject, and consumers resync current state without replaying effects or delaying healthy consumers

#### Scenario: Committed event reaches an open stream promptly
- **WHEN** a hook ingest, an in-process reader, a label/acknowledge/recovery command or a maintenance commit changes the revision
- **THEN** every open stream is notified without waiting for the periodic timer, and a burst of same-tick commits produces one flush per stream rather than one per commit

#### Scenario: A paused stream cannot delay ingest or other streams
- **WHEN** one open stream is not being read and accumulates backpressure
- **THEN** ingest, other commits and delivery to other open streams continue unaffected, and the paused stream is disconnected only after its own stall deadline
