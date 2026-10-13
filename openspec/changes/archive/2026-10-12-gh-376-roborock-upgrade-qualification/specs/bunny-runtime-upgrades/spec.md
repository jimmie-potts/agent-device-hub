## ADDED Requirements

### Requirement: Configured and retained Roborock upgrade qualification

For [#376](https://github.com/jimmie-potts/agent-device-hub/issues/376), routine upgrade admission SHALL support configured or retained Roborock only with complete coordinator-bound baseline, candidate, recovery and reupgrade evidence for the actual releases and format inventories. Existing fixed owner sets SHALL remain available; Roborock SHALL be an additional complete owner for each supported combination. Unknown owners, duplicate owners, partial BB-8 pairs, missing or duplicate phases and changed evidence MUST refuse. Source qualification MUST NOT establish installed or physical acceptance.

#### Scenario: Complete configured Roborock coverage
- **WHEN** an upgrade selects configured Roborock and complete bound coverage for every applicable owner
- **THEN** the profile admits only the exact qualified releases and evidence

#### Scenario: Incomplete or changed proof
- **WHEN** Roborock coverage lacks a phase, repeats an owner or phase, names an unknown owner, or its bound evidence changes
- **THEN** admission refuses before installed effects

#### Scenario: Existing optional-owner combinations
- **WHEN** Roborock coverage accompanies any supported legacy, ONN, paired BB-8 or companions coverage set
- **THEN** complete coverage is supported and the original sets remain available without Roborock receipts when it is unconfigured and unretained

### Requirement: Private Roborock ownership and reader admission

The procedure SHALL classify configured and retained Roborock using private metadata without opening live databases. Configured or retained Roborock MUST have a regular private primary store; configuration, directories and sidecars alone MUST NOT substitute. Selected previous, target and recovery artifacts MUST contain the delivered Roborock store reader when Roborock is configured or retained. Preflight and post-start checks SHALL require configured Roborock to report running, healthy and null-reason state. An unconfigured Roborock row SHALL retain only the existing refused, unhealthy, not-found exception. No qualification SHALL authorize account setup, device commands or installed activation.

#### Scenario: Metadata-only inventory
- **WHEN** a private regular primary store and supported sidecars belong to the configured or retained Roborock owner
- **THEN** inventory identifies that owner without reading or changing database bytes

#### Scenario: Primary store or reader missing
- **WHEN** Roborock is configured or retained but its primary store or a selected artifact's delivered reader is missing
- **THEN** the procedure refuses before effects and preserves original files

#### Scenario: Configured and absent health differ
- **WHEN** initial or post-start verification observes configured Roborock
- **THEN** only ordinary running healthy null-reason health passes; absence remains valid only for unconfigured Roborock

### Requirement: Latest Roborock archive and publication recovery

Qualification SHALL demonstrate preservation of private identity, original observation and record versions, room mappings, observed battery samples and gaps, unverified map bytes and provenance, and SDK outbox publication state across baseline, candidate, compatible recovery and reupgrade. Recovery MUST read distinct newer candidate observations before creating replacement observations or publishing retained state. Republish MUST preserve original envelope identity and MUST NOT replay collection or control effects. All fixture evidence SHALL be synthetic and private; four same-build source processes SHALL establish persistence only, while cross-release compatibility requires the exact artifact qualification used by installed admission.

#### Scenario: Candidate observations survive compatible recovery
- **WHEN** a candidate commits newer durable observations and a compatible recovery starts on that latest archive
- **THEN** recovery and reupgrade read those observations, original versions and private maps unchanged before any new collection

#### Scenario: Recovery silently restores older state
- **WHEN** a negative-control recovery starts from the older baseline instead of the candidate's latest state
- **THEN** qualification fails on missing newer observations rather than accepting a healthy process

#### Scenario: Pending state publication resumes
- **WHEN** a prior publication was refused and compatible recovery starts
- **THEN** retained state envelopes can be published unchanged while originals and latest projection remain intact and zero collection or vacuum-control effects occur
