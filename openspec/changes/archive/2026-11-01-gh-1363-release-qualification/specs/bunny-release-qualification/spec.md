## Purpose

Bind a B.U.N.N.Y. release qualification to the exact committed source, evaluation coverage and immutable ARM64 production image a deployment task consumes.

## ADDED Requirements

### Requirement: Qualification pins one integrated candidate

The qualification path SHALL select an immutable full source revision before work starts, reuse the existing full applicable checks and leave a running candidate fixed when newer source arrives. An active qualification SHALL finish without cancellation by newer candidates, retaining the newest pending candidate through workflow concurrency.

#### Scenario: New source arrives during qualification

- **WHEN** a candidate is running and multiple newer candidates arrive
- **THEN** the active candidate remains unchanged and the newest pending candidate is selected next
- **AND** omitted candidates receive no successful qualification claim

### Requirement: Promotion binds successful coverage to packaged bytes

A qualified result SHALL bind repository, source revision, evaluation revision and inputs, run and attempt, required job results, Linux ARM64 architecture, production image identity and archive digest. Packaged-image checks SHALL exercise the existing scenario and browser catalog, including its negative controls. A consumer SHALL verify authentic hosted run and artifact provenance in addition to receipt contents.

#### Scenario: Matching release qualifies

- **WHEN** every applicable source, workflow and packaged-image check succeeds for the pinned revision
- **THEN** the path produces a matching production image archive and a qualified result
- **AND** installation and physical acceptance remain separate

#### Scenario: Missing or mismatched evidence refuses promotion

- **WHEN** a check fails, is unexpectedly skipped, is missing, or evidence names another revision, image, archive or attempt
- **THEN** promotion is refused
- **AND** the installed release is untouched

### Requirement: Failed and incomplete candidates remain distinguishable

The qualification path SHALL preserve failed or incomplete outcomes and SHALL never infer qualification from newer source, partial results or an expired artifact. A retry SHALL retain its attempt identity and explicitly select the same candidate.

#### Scenario: Candidate fails or loses evidence

- **WHEN** a candidate fails a check or its required evidence is unavailable
- **THEN** consumers distinguish failed from incomplete work and cannot install it as a qualified release
