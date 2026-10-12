## ADDED Requirements

### Requirement: Configured and retained ONN upgrade qualification

The fixed production upgrade profile SHALL accept the selected ONN configuration
and private durable state only with complete ONN baseline, candidate,
compatible-recovery and re-upgrade qualification bound to the actual release
and format identities. Existing seven-owner and paired BB-8 certificates SHALL
remain valid for their qualified scopes. Unknown owners, missing coverage,
unsafe entries and incompatible recovery SHALL refuse before service effects.

#### Scenario: ONN is configured or retained
- **WHEN** ONN is configured or any selected ONN durable state remains
- **THEN** preflight requires complete bound ONN qualification and configured ONN must report running, healthy, reason-free state

#### Scenario: ONN coverage is missing or incomplete
- **WHEN** ONN is configured or retained but its four qualification phases are missing, duplicated, unbound or incompatible
- **THEN** preflight refuses before any service stop, release selection or device command

#### Scenario: ONN is absent
- **WHEN** ONN is unconfigured with no retained state and reports refused, not-found and unhealthy
- **THEN** the existing absent-ONN exception remains valid and requires no ONN coverage; running, healthy, wrong-reason or unknown states still refuse

#### Scenario: Candidate writes title observations and command outcomes
- **WHEN** the synthetic candidate writes title originals, gaps, reported progress, request identities, fences and outcomes before compatible recovery and re-upgrade
- **THEN** each separate process retains those latest records and private identities, settles interrupted responsibility truthfully, and never re-executes an earlier device command

#### Scenario: Recovery predates enabled history
- **WHEN** a proposed recovery cannot parse the selected history configuration or reopen its retained formats
- **THEN** qualification refuses that recovery rather than stripping settings, restoring older data or treating source tests as installed acceptance

## MODIFIED Requirements

### Requirement: Bounded absent ONN health qualification

The routine upgrade procedure SHALL recognize a reported ONN health row only when ONN is unconfigured, no ONN state is retained, and that row has state `refused`, reason code `not-found` and `healthy: false`. Preflight and post-start verification MUST apply the same bounded exception while retaining every other source, admission, state, health, ownership and recovery check. Configured or retained ONN MUST NOT use this absence exception; it requires the separately bound configured/retained ONN qualification. Unknown modules MUST remain outside the qualified profiles. The exception MUST NOT activate ONN or establish installed or physical acceptance.

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

