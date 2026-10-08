## Purpose

Prepare an ordered runtime cutover from explicit inventory and capacity facts,
without reading installed state or granting permission to execute the cutover.

## ADDED Requirements

### Requirement: Preparation has no installed effects

Cutover preparation SHALL consume explicit owner, source identity, destination,
writer, store, migration and capacity facts. It SHALL perform no filesystem
discovery, store read, service operation, hook change, migration or network call.
Every result SHALL state that execution is unavailable. Valid preparation SHALL
NOT claim that its supplied inventory is complete on the installed host, that
its source is qualified for installation, or that a migration has succeeded.
The existing Hub plan and install-receipt/1.0 behavior SHALL remain unchanged.

#### Scenario: Complete synthetic facts
- **WHEN** a caller supplies internally consistent synthetic facts
- **THEN** preparation returns an ordered plan without changing those facts
- **AND** the result makes no installed-readiness or execution-authority claim

### Requirement: Every declared source and writer is covered

The plan SHALL stop or fence every declared writer before backup. Every declared
physical source SHALL be backed up and verified once before any conversion,
including backup-only sources. Unknown writer/source references, duplicate IDs,
overlapping physical source paths and unreferenced migration-input sources SHALL
be refused. Backup-only sources SHALL NOT enter a conversion. Source and
destination paths SHALL be canonical absolute Linux paths and lexically separate;
these checks SHALL NOT be reported as proof against symlink or mount aliases.

#### Scenario: One physical configuration feeds several converters
- **WHEN** two selected conversions name the same physical configuration source
- **THEN** that source is backed up once and is available to both conversions
- **AND** its backup bytes are counted once

#### Scenario: Incomplete or conflicting inventory
- **WHEN** a store references an undeclared writer, a selected migration references
  an undeclared source, or source and destination roots overlap
- **THEN** preparation refuses the input without producing an executable plan

### Requirement: Conversion selection is explicit and ordered

Preparation SHALL require an explicit selection for each supported converter
group. A group is either converted from named physical sources with a converter
and verifier, or explicitly not configured with a reason. Selected conversions
SHALL retain the accepted Nanoleaf-before-Pixoo order and the remaining owner-tool
order, followed by verification of every converted result. Missing converters or
verifiers SHALL be reported as blockers, never as successful or skipped work.
Record-level import choices SHALL remain with the selected owning converters;
preparation SHALL add no CHOMPI or Wispr collector-data conversion.

#### Scenario: Caller supplies conversions out of order
- **WHEN** complete facts list selected Pixoo and Nanoleaf conversions in reverse
  order
- **THEN** the plan places the Nanoleaf conversion before the Pixoo conversion
- **AND** all backup verification precedes either conversion

#### Scenario: An owning converter is unavailable
- **WHEN** a selected conversion lacks its converter or verifier identity
- **THEN** preparation names that missing dependency and is blocked
- **AND** no conversion or activation is represented as completed

### Requirement: Capacity is checked before effects

Preparation SHALL account for each physical backup, selected conversion estimate,
release estimate and explicit reserve on its supplied destination volume.
Allocations sharing a volume SHALL be combined. Distinct volumes SHALL be checked
independently. Negative, fractional, nonfinite or unsafe byte counts and arithmetic
overflow SHALL be refused. Insufficient space SHALL block preparation before any
writer stops; caller-supplied sizes and volume IDs SHALL remain unverified facts.

#### Scenario: One destination volume is short
- **WHEN** the backup volume has spare space but the runtime volume cannot hold
  its allocations and reserve
- **THEN** preparation reports the runtime-volume shortage
- **AND** spare backup-volume capacity does not satisfy it

#### Scenario: Backup and runtime share a volume
- **WHEN** both destinations name the same volume
- **THEN** their allocations are combined and its reserve is counted once

### Requirement: The digest binds the current preparation

The preparation digest SHALL bind every meaningful supplied owner, source,
inventory, path, selection, adapter and capacity fact. Reordering set-like inputs
SHALL NOT change the digest. Checking a supplied digest SHALL recompute preparation
from the current facts and refuse any meaningful drift. Digest equality SHALL NOT
authorize installation or attest to facts the planner has not observed.

#### Scenario: Meaningful input changes after preparation
- **WHEN** a caller changes a source digest, writer target, destination, converter
  selection or capacity observation after obtaining a preparation digest
- **THEN** checking the old digest against the changed facts refuses it

#### Scenario: Equivalent inventories use a different order
- **WHEN** caller object fields and set-like inventory lists are reordered without
  changing their values
- **THEN** preparation returns the same digest and migration order
