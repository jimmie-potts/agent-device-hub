## ADDED Requirements

### Requirement: Commit notification without a registered consumer
The owner SHALL expose a listener registration that receives a notification after every committed revision, from any admission path, without a registered consumer ID, durable configuration or cursor. Registering or unregistering a listener MUST NOT change `incompatible-state` compatibility for an existing store. A listener error MUST be isolated from the commit path that raised it: it MUST NOT fault the collector, and the triggering call's outcome MUST remain successful.

#### Scenario: Every commit path notifies
- **WHEN** a session commit, a session-replacing commit (expiry, retirement, settlement or format migration) or a maintenance-only commit succeeds
- **THEN** every registered listener is called once for that revision, without requiring a consumer to have been configured at startup

#### Scenario: A throwing listener cannot fault admission
- **WHEN** a registered listener throws
- **THEN** the collector remains `running`, the triggering call's outcome is unaffected, and later commits still notify remaining and newly registered listeners

#### Scenario: Unsubscribing stops notifications
- **WHEN** a caller invokes the unsubscribe function a listener registration returned
- **THEN** that listener receives no further notifications from later commits
