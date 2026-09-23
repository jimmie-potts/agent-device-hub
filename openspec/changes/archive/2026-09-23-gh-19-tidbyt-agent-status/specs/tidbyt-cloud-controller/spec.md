## ADDED Requirements

### Requirement: Queued installation removal
The controller SHALL remove its configured cloud installation only through a `tidbyt.remove` request in the same serialized queue as display writes, under the controller-local `tidbyt-display` 1.1.0 profile. Removal MUST follow the same admission, identity, generation, authentication-hold, rate-limit and receipt rules as a push. The connection MUST send exactly one `DELETE /v0/devices/{device}/installations/{installation}` per admitted removal, classify it like a push and never retry it.

#### Scenario: Removal after a push
- **WHEN** a display request and then a removal request are admitted
- **THEN** the push completes before exactly one `DELETE` for the configured installation, and the removal receipt is a schema-valid controller v1 receipt with operation `remove`

#### Scenario: Removal failure classification
- **WHEN** the cloud answers the removal with 401, 429 or a server error after dispatch
- **THEN** the removal fails as unauthenticated with a hold, fails with `capacity` and a rate-limit hold, or is `uncertain` with possible prior effects, and it is not resent

#### Scenario: Malformed removal
- **WHEN** a removal request carries extra command fields or names another device
- **THEN** it is rejected before reservation and no request is sent
