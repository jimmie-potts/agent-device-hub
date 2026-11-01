## ADDED Requirements

### Requirement: Declared external ONN dependencies in complete backups

Stopped backup SHALL preserve the full original runtime configuration bytes and hash. It SHALL classify only the declared `modules.onn.adbSocket`, `hostExecutable` and `hostKeyDirectory` fields of an accepted ONN section as external host dependencies, recording their exact locations and values without inspecting, opening, hashing, copying or activating those dependencies. Other unsupported absolute paths SHALL refuse. Secret references SHALL retain their existing explicit path, byte, hash, ownership and lease-alias verification.

#### Scenario: Complete ONN configuration with unavailable host dependencies
- **WHEN** a stopped synthetic instance has an accepted ONN section whose declared host dependencies do not exist in the worker
- **THEN** backup and verification preserve the exact full configuration and retained ONN state, list those external dependencies and perform no dependency or device access

#### Scenario: Changed or unsupported reference
- **WHEN** configuration bytes, a secret reference, a declared dependency descriptor or an unsupported absolute path differs
- **THEN** verification or backup refuses without claiming completeness or writing a restore target

#### Scenario: Dependency overlaps a secret reference
- **WHEN** a declared host dependency lexically equals, contains or falls beneath an explicit secret reference
- **THEN** the worker refuses before reference I/O, without resolving or inspecting the dependency

### Requirement: Versioned maintenance helper attribution

New backups SHALL use manifest version 2, retaining the old runtime source revision separately from the actual maintenance helper's immutable image and revision. Version 1 archives SHALL retain legacy verification semantics. A newer helper for an older stopped instance SHALL require matching successful authentic hosted qualification and actual image/source/platform verification, with the existing exact-target, stopped-writer, lease, private-volume and no-network protections. Before artifact download or image load, the trusted host SHALL independently prove the candidate is an ancestor of the exact authenticated pinned main revision, refusing unavailable or contradictory comparisons. Candidate workflow assertions, raw image values or local receipt assertions SHALL NOT admit a helper.

#### Scenario: Qualified helper repairs old-image backup
- **WHEN** the selected old stopped image lacks the ONN backup repair and a matching qualified newer helper is explicitly selected
- **THEN** the fixed worker backs up the old full configuration and state with old-source and separate helper attribution, without changing or starting the old instance

#### Scenario: Invalid helper or archive version
- **WHEN** helper qualification or identity is missing or mismatched, or an archive version is unsupported
- **THEN** the operation refuses before backup/restore completion and preserves current state, while valid legacy version 1 verification remains available

#### Scenario: Successful unmerged candidate cannot approve itself
- **WHEN** authentic hosted jobs and artifacts report success but the candidate is not an ancestor of authenticated main, or the comparison is unavailable or contradictory
- **THEN** the host refuses before artifact download, image load or helper admission

### Requirement: Bounded operational refusal reporting

Backup and restore refusals SHALL report the shared canonical error body on stderr, with an allowlisted existing error code, its registry retryability and a fixed bounded detail identifying the operational stage. The host SHALL accept only exact known canonical worker bodies. Success stdout SHALL retain its machine-readable role. Unknown worker/subprocess failures SHALL use a fixed fallback, without exposing exception messages, configured values, private paths, credentials or raw subprocess output.

#### Scenario: Configuration and worker failures remain distinguishable
- **WHEN** configuration-reference validation refuses or a worker fails unexpectedly
- **THEN** the host reports the corresponding fixed code/stage or bounded fallback, preserves partial evidence and does not automatically retry or print private error content
