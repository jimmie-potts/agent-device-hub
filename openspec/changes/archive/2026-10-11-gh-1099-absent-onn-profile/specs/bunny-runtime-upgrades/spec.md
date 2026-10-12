## ADDED Requirements

### Requirement: Bounded absent ONN health qualification

The routine upgrade procedure SHALL recognize a reported ONN health row only when ONN is unconfigured, no ONN state is retained, and that row has state `refused`, reason code `not-found` and `healthy: false`. Preflight and post-start verification MUST apply the same bounded exception while retaining every other source, admission, state, health, ownership and recovery check. Configured or retained ONN and unknown modules MUST remain outside this qualified profile. The exception MUST NOT activate ONN or establish installed or physical acceptance.

#### Scenario: Shipped ONN is absent from the selected configuration
- **WHEN** the qualified configuration/state inspection finds no ONN configuration or retained state and ONN reports the exact refused/not-found/unhealthy row with the required degraded aggregate health
- **THEN** preflight and post-start health verification admit that exception only after their other gates pass

#### Scenario: ONN is configured or has retained state
- **WHEN** ONN configuration or any retained ONN state is present
- **THEN** the unqualified owner is refused without opening, modifying or removing its database or files

#### Scenario: ONN health does not describe the bounded absence
- **WHEN** ONN reports running, healthy, a different refusal reason or an inconsistent aggregate status
- **THEN** preflight and post-start verification refuse using their existing safe failure surfaces

#### Scenario: An unknown module is reported
- **WHEN** a health row names a module outside the explicitly qualified profile
- **THEN** verification refuses without treating that row as an absent ONN exception

#### Scenario: Qualified previous release does not report ONN
- **WHEN** an otherwise qualified previous release reports no ONN row and no ONN configuration or state exists
- **THEN** its existing health/admission checks remain applicable without requiring a fabricated ONN row or changing the legacy seven-owner certificate format
