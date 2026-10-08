## ADDED Requirements

### Requirement: Session label command family

The core families SHALL include `session-label-set/2.0` for `org.bunny.session-label.set.requested` on `bunny.cmd.session-label-set.<session>`, targeting the qualified session entity ID. Its closed payload SHALL contain `requestId`, `label` and `expectedRevision`. `label` SHALL be null for clearing or a string of 1–80 Unicode scalar values satisfying the session display-text and credential-exclusion rules. `expectedRevision` SHALL be a nonnegative safe integer. Completion SHALL use `org.bunny.session-label.set.completed` with the existing `outcome/2.0` payload and matching request identity.

#### Scenario: Set and clear payloads
- **WHEN** a valid request targets a qualified session with a permitted label or null and a safe expected revision
- **THEN** the family validates it and its corresponding outcome without introducing an authority field

#### Scenario: Invalid or private payloads
- **WHEN** a request has an empty or oversized label, an invalid scalar, prohibited control or credential-like text, an invalid revision or identity, or an extra field
- **THEN** the validator refuses it with the profile's typed error
