# shared-monitor-installation Specification

## Purpose

Provide reversible shared monitoring setup without changing agent permissions, unrelated hooks, controller ownership or the separately authorized installation boundary.

## Requirements

### Requirement: Reviewed reversible configuration

Setup SHALL provide inspect, plan, apply and remove operations for explicitly named Linux/WSL client files. Plans MUST show the exact owned hook additions/removals and precondition digest. Apply MUST preserve unrelated hooks and trust settings, retain private backups outside Git and reject concurrent edits or ambiguous ownership. Removal MUST use current configuration rather than restore an old whole-file backup.

#### Scenario: User edits between installation and removal
- **WHEN** the user removes an unrelated hook and adds a different hook after setup
- **THEN** removal deletes only unchanged owned entries and preserves both user changes

#### Scenario: Conflicting plan or ownership
- **WHEN** a target changes after planning or an owned entry is edited
- **THEN** setup refuses to overwrite the changed configuration

#### Scenario: Installed receipt from the previous event list
- **WHEN** setup is re-applied on an installed Claude receipt that lacks the two tool-completion events
- **THEN** it adds exactly those entries and keeps the credential, and the receipt remains inspectable and removable before the re-apply

### Requirement: One qualified fail-open producer

Setup MUST retain one producer configuration per provider/source and use the selected owner's authenticated event endpoint. Codex and Claude hooks MUST emit only shared allowlisted metadata, silently exit successfully within a bounded deadline and leave unqualified paths disabled. Linux invocation and explicit Windows-to-WSL command construction MUST preserve argument boundaries without permission or trust bypasses.

#### Scenario: Unqualified or unavailable monitoring
- **WHEN** qualification is absent, input is invalid or the endpoint is unavailable
- **THEN** the hook exits silently with success and cannot deny agent work

#### Scenario: Qualified event
- **WHEN** a qualified hook receives an identified session event with private input fields
- **THEN** only the normalized metadata reaches the selected owner once, without private input fields

### Requirement: Owned credential lifecycle

Producer credentials MUST be independently provisioned and durably owned. Removal MUST revoke owned access before removing its configuration and MUST preserve unrelated credentials. Interrupted setup MUST retain enough private intent to recover without silently enabling a partially installed source.

#### Scenario: Revocation failure
- **WHEN** the selected owner cannot confirm revocation
- **THEN** removal remains incomplete and retains the ownership receipt for retry

### Requirement: Explicit consumer and state-owner cutover

Setup MUST compose the delivered quiesced export/import and consumer source-selection interfaces. Source identities, current labels, notices and revisions MUST survive handoff and rollback. Producer emission MUST remain disabled or owner admission fenced until the selected owner and consumers are ready. Legacy Nanoleaf ingestion MUST remain selected until an explicit verified cutover and rollback MUST restore its retained current configuration. No setup operation SHALL introduce another device writer or open a controller database.

#### Scenario: Interrupted state handoff
- **WHEN** readiness or a route update fails during cutover
- **THEN** ingestion remains fenced and recovery uses the latest exported state without automatically restarting the former owner

#### Scenario: Two consumers and explicit rollback
- **WHEN** an identified event is admitted after cutover
- **THEN** both consumer projections observe that identity from the selected owner, and explicit rollback restores the selected prior path without duplicate ingestion or replaying expired effects

### Requirement: Inspection and evidence boundaries

Inspection MUST return sanitized source/consumer setup status without writing, polling devices or changing selection. The runbook MUST distinguish documented versions, source fixtures, installed-client qualification and physical acceptance, including named installation ownership, credentials, trust review, startup/shutdown, reachability and recovery. Native Windows installation is outside this delivery.

#### Scenario: Inspect without effects
- **WHEN** a frontend or operator inspects setup
- **THEN** it receives neutral identities and qualification/ownership state without tokens, private paths, configuration changes or device activity

### Requirement: Explicit producer lifecycle selection
Setup input and staged producer files SHALL accept an optional `lifecycleVersion` of `1.1` or `1.2` and reject other values. The installed hooks SHALL produce the selected envelope version, and a configuration without the field SHALL keep lifecycle 1.0. An installed receipt SHALL NOT change its selected version in place.

#### Scenario: Selecting lifecycle 1.2
- **WHEN** a reviewed setup with `lifecycleVersion:"1.2"` is applied for a Claude source
- **THEN** its producer emits lifecycle 1.2 envelopes, while existing receipts and configurations keep their versions
