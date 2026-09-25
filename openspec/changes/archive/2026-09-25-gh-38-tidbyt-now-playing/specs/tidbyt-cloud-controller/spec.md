## MODIFIED Requirements

### Requirement: Queued installation removal
The controller SHALL remove a configured cloud installation only through a `tidbyt.remove` request in the same serialized queue as display writes, under the controller-local `tidbyt-display` 1.2.0 profile. Removal MUST follow the same admission, identity, generation, authentication-hold, rate-limit and receipt rules as a push. The connection MUST send exactly one `DELETE /v0/devices/{device}/installations/{installation}` per admitted removal, classify it like a push and never retry it.

#### Scenario: Removal after a push
- **WHEN** a display request and then a removal request are admitted
- **THEN** the push completes before exactly one `DELETE` for the configured installation, and the removal receipt is a schema-valid controller v1 receipt with operation `remove`

#### Scenario: Removal failure classification
- **WHEN** the cloud answers the removal with 401, 429 or a server error after dispatch
- **THEN** the removal fails as unauthenticated with a hold, fails with `capacity` and a rate-limit hold, or is `uncertain` with possible prior effects, and it is not resent

#### Scenario: Malformed removal
- **WHEN** a removal request carries an unknown command field or names another device
- **THEN** it is rejected before reservation and no request is sent

## ADDED Requirements

### Requirement: Additional configured installations
The cloud connection SHALL accept up to four additional installation IDs from private configuration, each distinct and different from the default installation. A display or removal command MAY name one of them in an `installation` field; without it, the write targets the default installation. The controller MUST reject an installation the current connection does not list before reserving an identity. Writes for every installation SHALL share the device's single queue, generations, holds and receipts. Installation evidence SHALL be kept and reported per installation, and `reconfigure()` SHALL clear all of it.

#### Scenario: Named installation push
- **WHEN** a display request names a configured additional installation
- **THEN** exactly one background push is sent with that installation ID, and a later request without the field pushes the default installation

#### Scenario: Unknown installation
- **WHEN** a request names an installation that the connection does not list
- **THEN** it is rejected as `invalid-request` before reservation and nothing is sent

#### Scenario: Shared hold
- **WHEN** a push to one installation receives 429
- **THEN** queued writes to every installation wait for the same rate-limit hold

#### Scenario: Per-installation evidence
- **WHEN** `refresh()` reads an additional installation's presence
- **THEN** the snapshot reports that installation's evidence separately from the default installation's
