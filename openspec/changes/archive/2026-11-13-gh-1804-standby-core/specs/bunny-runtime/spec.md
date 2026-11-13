## ADDED Requirements

### Requirement: Standby settings-only core

Standby SHALL open and validate the authoritative core settings under the
normal runtime lease. It SHALL keep session ownership, general sync and
effect-capable work inactive and retain pending operational publication.

#### Scenario: Eligible work remains inactive
- **WHEN** a standby opens valid settings and an occurrence, routine, art plan or power limit could produce work on an active core
- **THEN** the core serves committed internal settings without accepting, scheduling, tracking, spending on or dispatching the work

#### Scenario: Standby restarts on existing state
- **WHEN** standby starts, reads settings and stops on a current store with pending operational work
- **THEN** session, operation, history, revision, guard and outbox records remain unchanged and no work is replayed

#### Scenario: Settings cannot become ready
- **WHEN** lease acquisition, export validation, consumer compatibility, settings projection or startup cancellation prevents a successful open
- **THEN** settings remain unavailable and any logical lease is released without releasing process ownership
