## ADDED Requirements

### Requirement: Native assistant source versions

The package SHALL register `session/3.1`, `lifecycle/2.2` and version 2.1 of `attention-raised`, `attention-cleared` and `turn-ended`. Each SHALL be its predecessor with the identity widened to the supported-source definition, which names the native provider `bunny` with client `assistant` and producer source `bunny/modules/companions`. `lifecycle/2.2` SHALL add the inputs `turn-waiting` (work idle, no notice) and `turn-uncertain` (work unknown, activity lost) and an optional `result` of `succeeded`, `failed` or `cancelled` on `turn-ended`; `session/3.1` SHALL keep that result on the notice. The status function SHALL detail `finished` by the result of the last counting notice that has one, and by `turn-ended` otherwise. A test SHALL keep each new schema equal to its predecessor apart from these members, its `$id` and its description.

#### Scenario: A record without the native source
- **WHEN** a Codex record with no notice result is built
- **THEN** it validates as `session/3.0` and as `session/3.1`, and its status is the same under both

#### Scenario: A finished failure
- **WHEN** a native record's counting notice has result `failed`
- **THEN** its status is `finished` with detail `failed`, and a reader that does not know the detail shows `finished`

## MODIFIED Requirements

### Requirement: One supported-source definition

The package SHALL define each supported agent source once, its provider, its clients, the hook names it maps and, for an in-process source, its one producer source, and SHALL derive from that definition the `Identity` type, the provider and client enums of the `lifecycle`, `session/3.0` and `session/3.1` schemas and the 2.1 occurrence versions, and the source check of the runtime's hook adapter. A contract test SHALL fail when any of them differs from the definition. A new source SHALL be one entry in the definition and a new minor version of the families whose enums it widens. A source with no hooks SHALL never pass the hook adapter's check. The retained 1.x packages SHALL keep their own lists.

#### Scenario: A schema that drifts
- **WHEN** the `session/3.1` schema's provider enum names a provider the definition does not
- **THEN** the contract test fails and names the enum

#### Scenario: A hook that claims the native source
- **WHEN** a hook payload names the native provider
- **THEN** the hook adapter maps nothing for it

### Requirement: Shared session read function

The package SHALL provide one read function that every session reader uses: it SHALL validate a session state message and return a version-independent view, holding the identity, parent, turn, generation, revision, status, claims, notices with their results, read evidence, receipt provenance, unavailable evidence and display metadata, or nothing for a message it does not accept. It SHALL read `session/3.0` and `session/3.1`, whose record is the view; a `session/2.0` or `session/2.1` record stays a valid retained document that no reader reads, and a reader from an older release finds no record in a version it does not know. The package SHALL also provide the status function the core uses, the record builder the core publishes with, which makes active work unconfirmed for its deadline, a restart or ambiguous or lost activity evidence and never makes other work unconfirmed, a per-consumer function that retires `finished` to `quiet` under a consumer's acknowledgment and read policy, and an opportunity match that requires the same generation, identity and turn and the attention item or unacknowledged notice the opportunity names. A detail the reader does not know SHALL fall back to its class, and an unknown detail SHALL never make an action eligible.

#### Scenario: A waiting session past its deadline
- **WHEN** a `session/3.0` record with an approval whose running work is unconfirmed for its deadline is read, and a `session/2.0` record of the same session
- **THEN** the first view needs the owner and its attention stays confirmed whatever its age, a working record unconfirmed for its deadline reads as working with unconfirmed work, and the `session/2.0` record reads as nothing

#### Scenario: An unknown detail
- **WHEN** a record's status is `finished` with a detail the reader does not know
- **THEN** the view shows `finished`, and an opportunity match that depends on the detail is refused

#### Scenario: A reader from the previous release
- **WHEN** a read function that knows only `session/3.0` reads a native `session/3.1` record and a Claude `session/3.0` record
- **THEN** it returns nothing for the first and the Claude view for the second
