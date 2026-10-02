## ADDED Requirements

### Requirement: Startup-scoped running build identity

The Hub SHALL report `build: {sourceRevision, version}` from its own package metadata in read-authorized health and dashboard context. It MUST retain that identity for the running instance, expose no metadata paths and preserve existing authorization, state-revision meaning and unhealthy status.

#### Scenario: Another release becomes current
- **WHEN** a process is running and its manifest or the installation's current link changes
- **THEN** it continues reporting its startup identity until a restarted process loads its own release, and health and context agree

#### Scenario: Metadata is unavailable or malformed
- **WHEN** its manifest is missing, unreadable, malformed or has invalid identity values
- **THEN** unavailable identity fields report `unknown`, no checkout or symlink lookup invents provenance, and existing health failures remain failures

### Requirement: Truthful Hub package provenance

The Hub archive manifest SHALL stamp the full lowercase source revision from a clean known checkout and MUST stamp `unknown` when source provenance is dirty, unavailable or changes during packaging. Equal versions MUST NOT imply equal source identities.

#### Scenario: Clean and dirty builds
- **WHEN** packaging runs from a clean known commit or from a modified tree
- **THEN** the respective manifest reports that full commit or `unknown`

#### Scenario: Two releases have the same version
- **WHEN** two clean commits keep the same package version
- **THEN** their packaged identities retain their distinct source revisions
