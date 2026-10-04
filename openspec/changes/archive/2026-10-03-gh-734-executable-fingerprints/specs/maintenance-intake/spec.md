## ADDED Requirements

### Requirement: Trusted executable fingerprint checks remain bounded

Maintenance intake and owning closeout SHALL verify configured trusted files up to 512 MiB without buffering each whole file. Files above that bound, nonregular files, final symlinks, multiply linked files, changed reads and mismatched SHA256 values MUST refuse operation. Private configuration and retained-evidence read limits MUST remain separate and unchanged.

#### Scenario: Installed executable exceeds the private read limit
- **WHEN** a trusted regular executable exceeds 128 MiB but is within 512 MiB and matches its configured SHA256
- **THEN** intake and closeout accept its fingerprint without invoking the executable during verification

#### Scenario: Unsafe or changed trusted file
- **WHEN** a trusted file exceeds 512 MiB, is nonregular, is a final symlink, has multiple hard links, changes during reading, or does not match its configured SHA256
- **THEN** verification refuses before planning or public effects

#### Scenario: Private content limits stay independent
- **WHEN** configuration or retained evidence exceeds its existing bounded-read limit
- **THEN** it remains rejected even when a trusted executable of that size can be fingerprinted
