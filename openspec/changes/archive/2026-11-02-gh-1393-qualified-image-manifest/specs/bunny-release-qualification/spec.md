## ADDED Requirements

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
