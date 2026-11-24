## ADDED Requirements

### Requirement: Companion metadata contracts

The package SHALL register `session/3.2` and `lifecycle/2.4` ([Hub #2054](https://github.com/jimmie-potts/agent-device-hub/issues/2054)). `session/3.2` SHALL be `session/3.1` with an optional `companions` list, and `lifecycle/2.4` SHALL be `lifecycle/2.3` with the same optional list. Each entry SHALL hold a companion's stable `id`, a routing ID of at most 64 characters, and its display `name`, 1 to 40 Unicode scalar values of session display text; the list SHALL hold 1 to 8 entries, each ID once, in the producer's order: one for a companion's own conversation and every companion of a shared room. Only a native B.U.N.N.Y. assistant session or observation SHALL carry the list, `metadata-observed` SHALL never carry it, and nothing SHALL put it in `project`, `label` or `title`. `sessionSchemaOf` SHALL select `session/3.2` for a record with companions, `session/3.1` for another native record or a notice result, and `session/3.0` otherwise. Tests SHALL keep each new schema equal to its predecessor apart from these members, its `$id` and its description.

#### Scenario: Native companions
- **WHEN** a native record names Reachy, and the companions producer sends a lifecycle observation that names Reachy, in the new versions and in `session/3.1` and `lifecycle/2.3`
- **THEN** only the new versions accept them, and the record is published as `session/3.2`

#### Scenario: Refused companions
- **WHEN** a Claude record or a hook observation carries companions, a native title observation carries them, the list is empty or holds nine entries or one ID twice, or a name is 41 characters, multi-line or credential-shaped
- **THEN** each is refused, and title metadata without companions stays valid in `lifecycle/2.3` and `2.4`

## MODIFIED Requirements

### Requirement: Shared session read function

The package SHALL provide one read function that every session reader uses: it SHALL validate a session state message and return a version-independent view, holding the identity, parent, turn, generation, revision, status, claims, notices with their results, read evidence, receipt provenance, unavailable evidence and display metadata, or nothing for a message it does not accept. It SHALL read `session/3.0`, `session/3.1` and `session/3.2`, whose record is the view, holding a native session's companions in `session/3.2`; a `session/2.0` or `session/2.1` record stays a valid retained document that no reader reads, and a reader from an older release finds no record in a version it does not know until it is updated. The package SHALL also provide the status function the core uses, the record builder the core publishes with, which makes active work unconfirmed after a restart or for ambiguous or lost activity evidence, never from silence, and never makes other work unconfirmed, a per-consumer function that retires `finished` to `quiet` under a consumer's acknowledgment and read policy, and an opportunity match that requires the same generation, identity and turn and the attention item or unacknowledged notice the opportunity names. A detail the reader does not know SHALL fall back to its class, and an unknown detail SHALL never make an action eligible.

#### Scenario: A waiting session past its deadline
- **WHEN** a `session/3.0` record with an approval whose running work has been silent for an hour, long past the five minutes the retired deadline allowed, is read, a working record a restart left unconfirmed, and a `session/2.0` record of the same session
- **THEN** the first view needs the owner with its attention and work confirmed whatever its age, the second reads as working with unconfirmed work and reason `restart`, and the `session/2.0` record reads as nothing

#### Scenario: An unknown detail
- **WHEN** a record's status is `finished` with a detail the reader does not know
- **THEN** the view shows `finished`, and an opportunity match that depends on the detail is refused

#### Scenario: A reader from the previous release
- **WHEN** a read function that knows only `session/3.0` reads a native `session/3.1` record and a Claude `session/3.0` record
- **THEN** it returns nothing for the first and the Claude view for the second

#### Scenario: A record with companions
- **WHEN** the read function reads a native `session/3.2` record that names Reachy, and a read function of the release before reads it and a native `session/3.1` record without companions
- **THEN** the current function's view holds the companions apart from the title and label, and the earlier one returns nothing for the first and the view for the second
