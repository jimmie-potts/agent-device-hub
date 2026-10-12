## ADDED Requirements

### Requirement: Configured and retained BB-8 qualification

The established-runtime procedure SHALL admit configured or retained BB-8 only
with coordinator-bound compatibility coverage for its latest production state,
accepted responsibility, SDK outbox and independently owned Windows receipts.
Storage-bearing Windows helper inputs MUST participate in conservative format
classification. Recovery and re-upgrade MUST preserve latest durable evidence
without replaying any robot operation, changing enrollment or opening the
Windows receipt database from WSL. Configured BB-8 MUST satisfy ordinary running
module health; an absent-module exception SHALL apply only when unconfigured.
Admission SHALL preserve the separately qualified boundaries for all other
modules. Source qualification MUST NOT establish installation or physical
acceptance.

Admission MUST preserve the legacy seven-owner coverage shape. Configured or
retained BB-8 MUST require the complete `bb8` and `bb8-windows` pair, each with
`baseline`, `candidate`, `recovery` and `reupgrade` evidence. A partial pair or
missing phase MUST refuse; a seven-owner certificate MUST NOT admit configured
or retained BB-8.

#### Scenario: Configured or retained BB-8 has complete compatible evidence
- **WHEN** the selected releases have complete bound production-store recovery and re-upgrade evidence for configured or retained BB-8
- **THEN** the read-only plan includes BB-8's durable ownership and admits it only with the required configured-module health

#### Scenario: Latest BB-8 state survives recovery
- **WHEN** a disposable candidate commits LED intent, reported power, interrupted responsibility and completed outcomes before compatible recovery and re-upgrade
- **THEN** every latest record remains readable, interrupted effects remain uncertain or failed as appropriate, and no robot operation replays

#### Scenario: Windows helper storage-bearing input changes
- **WHEN** a selected helper input differs between the qualified and candidate releases
- **THEN** format classification requires renewed compatibility evidence rather than treating the change as documentation or operator-only work

#### Scenario: Missing coverage or unhealthy configured BB-8
- **WHEN** BB-8 is configured or retained without complete compatible evidence, or its configured module is refused, stopped or unhealthy
- **THEN** admission refuses before any service, mutable state or device effect

#### Scenario: Unconfigured BB-8 remains absent
- **WHEN** BB-8 is unconfigured and its health row is refused with not-found and healthy false
- **THEN** the existing bounded absent-module exception remains available without activating the module or contacting a robot

#### Scenario: Legacy coverage remains available without selected BB-8
- **WHEN** no BB-8 configuration or retained state is selected and the original seven-owner certificate has complete matching source, format and phase bindings
- **THEN** that coverage shape remains accepted without requiring either additional BB-8 owner

#### Scenario: Qualified BB-8 coexists with absent ONN
- **WHEN** configured or retained BB-8 has its complete paired evidence and ONN is unconfigured without retained state, with its exact refused/not-found/unhealthy health row
- **THEN** initial and post-start checks preserve the BB-8 coverage requirement and the separately qualified ONN absence boundary together
