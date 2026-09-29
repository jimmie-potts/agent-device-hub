## Purpose

Define traceable guide issue and sub-guide records so browsing, discovery and
work recommendations can distinguish authoritative facts from missing evidence.

## ADDED Requirements

### Requirement: Versioned authoritative records
The contract SHALL define stable identities, source references, field ownership,
version compatibility, typed values and independent issue, graph and editorial
freshness. It SHALL preserve native relationships separately from related prose
and idea extensions.

#### Scenario: Version or source mismatch
- **WHEN** a record names an unsupported version or a different dataset
- **THEN** validation rejects the record for composition without replacing the full guide

#### Scenario: Authored sub-guide
- **WHEN** a sub-guide references known issues
- **THEN** it retains its authored identity, source revision, date and owner rather than inheriting issue freshness

### Requirement: Evidence-specific operation gates
The contract SHALL retain incomplete issues for browsing and SHALL withhold
claims whose required evidence is unavailable, stale or conflicting. Readiness
SHALL require explicit ready status and complete fresh native prerequisite evidence.

#### Scenario: Dependency read fails
- **WHEN** issue facts are available but dependency pagination is incomplete
- **THEN** browsing remains available and a ready-work claim is withheld with a source-linked reason

#### Scenario: Conflicting workflow labels
- **WHEN** an open issue carries more than one workflow status
- **THEN** the conflict is reported and no ready-work claim is permitted

#### Scenario: Source completion
- **WHEN** GitHub records a completed closure
- **THEN** the record permits a source closure fact but does not establish installation or physical acceptance

### Requirement: Bounded public planning projection
The contract SHALL restrict model input to an application-built allowlist of
public planning facts and the submitted question. Raw bodies, execution prompts,
session transcripts, private paths, credentials and device operations SHALL be
excluded. Graph facts and exact counts SHALL be computed by code.

#### Scenario: Unexpected projection field
- **WHEN** a projection contains a raw body or an undeclared field
- **THEN** validation rejects the projection

### Requirement: Contract-only approval and lifecycle evidence
The definition SHALL have offline success and failure fixtures, a cross-interface
trace and an approval record binding its exact content before adoption. The
trace SHALL preserve the full guide on timeout, missing data, catalog mismatch
and late replies after reset, with equivalent reduced-motion meaning.

#### Scenario: Unapproved candidate
- **WHEN** the definition is drafted but owner approval is absent
- **THEN** it may be reviewed and tested but cannot be adopted or merged

#### Scenario: Reset before a late response
- **WHEN** a fake-provider trace resets to Full guide before a response arrives
- **THEN** the response cannot replace the reset view or change the underlying records
