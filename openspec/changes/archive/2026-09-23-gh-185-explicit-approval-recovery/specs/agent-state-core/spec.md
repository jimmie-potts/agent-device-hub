## ADDED Requirements

### Requirement: Explicit uncertain approval recovery
The owner SHALL allow an authorized host to retire exactly one unknown-ID approval for an exact session and known turn only when that session is uncertain and the request names the current owner revision. It SHALL persist a recovery diagnostic and preserve unrelated attention, activity, notices and uncertainty. Recovery SHALL NOT approve or deny a provider permission or infer that work succeeded. A fresh provider observation MAY create a new approval marker.

#### Scenario: Recover one old uncorrelated approval
- **WHEN** an explicit operation names a session, its current known turn and revision with exactly one unknown-ID approval and uncertain session freshness
- **THEN** only that approval is removed in a durable new revision while other state remains and a recovery journal entry is retained

#### Scenario: Reject ambiguous or changed evidence
- **WHEN** evidence is fresh, the revision or turn changed, or zero or multiple matching approvals exist
- **THEN** the owner rejects recovery without changing state
