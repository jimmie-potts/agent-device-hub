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
