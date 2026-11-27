## ADDED Requirements

### Requirement: Qualified cloud coding workspace

Auto and pinned cloud routing SHALL require current sharing permission, ordinary worker eligibility and cloud authority that binds the operation, repository revision, harness and worker connection to an unexpired provider workspace with enforced compute, storage and teardown limits. Cloud workers SHALL be ineligible for installed operations and local device steps. The normal runtime SHALL default to no cloud authority.

#### Scenario: Enrollment alone
- **WHEN** a cloud worker declares readiness without a qualified workspace for the operation
- **THEN** Auto SHALL exclude it and a pinned cloud request SHALL refuse without dispatching work

#### Scenario: Disposable cloud qualification
- **WHEN** a scoped disposable provider enforces the requested limits and verifies the workspace connection
- **THEN** the matching operation MAY select it, and the qualification SHALL require exact cleanup evidence
- **AND** ambiguous launch or cleanup SHALL hold that qualification without a new launch
