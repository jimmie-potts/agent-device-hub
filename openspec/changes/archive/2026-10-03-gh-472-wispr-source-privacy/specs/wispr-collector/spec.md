## MODIFIED Requirements

### Requirement: Private paths and explicit source binding
Config, retained state, backups and outputs SHALL reside in owner-restricted Windows locations outside Git and cloud-synced directories. Only the current owner, SYSTEM and Administrators SHALL have allowed access to collector-owned files. The collector SHALL accept existing additional ACL grants on the explicitly selected Wispr source and its SQLite sidecars without changing their permissions. Source ownership qualification and all local fixed-drive, containment, Git/cloud and redirect restrictions SHALL still apply. The collector MUST reject network/UNC SQLite paths and unsafe symlink/reparse redirects. Source replacement MUST require explicit namespace reconciliation; account identity MUST NOT be inferred by reading login/session files. Diagnostics SHALL use fixed codes without private paths or source values.

#### Scenario: Unsafe path or replacement
- **WHEN** a configured path resolves through an unsafe redirect or the source file identity changes
- **THEN** collection fails closed until the owner explicitly resolves the path or source binding

#### Scenario: Selected vendor source has another reader
- **WHEN** an otherwise qualified owner-selected source and its SQLite sidecars allow another principal to read
- **THEN** collection accepts those permissions, leaves source bytes and ACLs unchanged, and publishes only to qualified private collector paths

#### Scenario: Collector-owned data allows another reader
- **WHEN** configuration, retained state, a managed backup or an export allows a principal beyond the current owner, SYSTEM and Administrators
- **THEN** the command rejects the private path before updating retained analytics or replacing output
