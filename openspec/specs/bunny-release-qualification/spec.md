# bunny-release-qualification Specification

## Purpose

Bind a B.U.N.N.Y. release qualification to the exact committed source, evaluation coverage and immutable ARM64 production image a deployment task consumes.

## Requirements

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

### Requirement: New Mac qualification metadata identifies the saved manifest

For the established Mac/containerd lane, new qualification image metadata SHALL identify the exact single saved OCI image manifest by its raw content digest. Before emitting metadata, the producer SHALL verify its saved manifest/configuration graph against the already tested production image, including descriptor hashes and sizes, ordered layer DiffIDs, committed source revision, Linux ARM64 platform and user `1000:1000`. Compressed layer content digests SHALL remain distinct from uncompressed DiffIDs. Archive processing SHALL use finite byte, entry, metadata and time bounds without extracting archive paths. Existing receipt fields, production-parent checks and strict consumer/helper/container identity comparisons SHALL remain unchanged.

#### Scenario: Producer-local configuration ID differs from the saved manifest

- **WHEN** the producer's tested image has a configuration ID distinct from the verified saved manifest digest
- **THEN** new image metadata names the manifest digest and exact archive hash
- **AND** the producer-local ID remains the build/test/save handle

#### Scenario: Corrupt, mismatched or ambiguous archive refuses

- **WHEN** the archive is malformed, unsupported, over a finite bound, ambiguous or mismatched with the tested production image
- **THEN** the producer refuses metadata emission through its failed/incomplete qualification path
- **AND** it does not select an image using labels or command output alone

#### Scenario: Historical receipt remains unchanged

- **WHEN** a prior authentic receipt records its producer-local configuration ID and Mac consumption refused
- **THEN** that receipt and failed intake remain unchanged
- **AND** the correction requires a newly generated matching qualification rather than rewriting or aliasing the prior result
