## ADDED Requirements

### Requirement: Composition readiness reads devices as the dashboard does
Composition readiness and `doctor` SHALL read each consumer's controller through the Hub with the dashboard's versioned read, `/api/controllers/v1/<alias>/snapshot?apiVersion=1.1`. A failed versioned read SHALL fail that consumer's `hub-reads-<id>` check, even when the controller's unversioned read succeeds.

#### Scenario: Device card the dashboard cannot load
- **WHEN** a consumer's controller answers the Hub's unversioned read but fails its versioned read
- **THEN** readiness fails with that consumer's `hub-reads-<id>` check named, and the healthy consumer's checks pass

### Requirement: Composed adapters keep proof under the Hub proof root
When `APP_VERIFY_PROOF_ROOT` is not set, the orchestrator SHALL run every adapter with `APP_VERIFY_PROOF_ROOT` set to the Hub's proof root, so consumer receipts and events stay under the canonical Hub checkout when a consumer runs from a disposable checkout. An explicitly set `APP_VERIFY_PROOF_ROOT` SHALL be passed through unchanged.

#### Scenario: Consumer in a disposable checkout
- **WHEN** a composition runs a consumer from a checkout that is later removed
- **THEN** the consumer's receipt and events remain under the Hub's proof root
