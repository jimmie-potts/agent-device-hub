## MODIFIED Requirements

### Requirement: Trusted release and compatible recovery

Every new target MUST have a clean merged full source identity, trusted archive and manifest hashes, verified safe inventory and dependency closure. Before outage, the command MUST prove previous-release compatibility with all durable data the target can write using format evidence and an isolated write/reopen test. Unknown or incompatible recovery MUST refuse.

Format evidence SHALL require the durable surface of the installer, the previous release and the target to be byte-identical, ignoring file modes. The durable surface is the Hub storage adapter, automation store and automation modules and the validators they apply to stored rows; any other Hub module that imports `node:sqlite` apart from the named read-only state capture and migration lease; the agent-state durable validator and identity-key modules; every agent-state schema except snapshot schemas; and the lifecycle 1.0 and 1.1 schemas. Agent-state and lifecycle files that the updater does not classify as non-durable MUST count as durable. Reducer, provider, retention, snapshot, coordination and constants modules, newer lifecycle versions and lifecycle envelope code are outside the surface. The write/reopen test MUST cover the stored session metadata and a known parent as well as the existing record kinds.

#### Scenario: Provenance or compatibility refusal
- **WHEN** source is dirty, archive bytes differ, a path escapes its release, same-SHA bytes conflict or recovery compatibility is unknown
- **THEN** the command refuses without stopping the installed owner

#### Scenario: Latest durable records survive recovery
- **WHEN** the target writes newer identities, revisions, labels, notices, acknowledgments, rules, settings or consumed-event history and recovery runs
- **THEN** the previous program reopens the latest state without restoring an older database or repeating consumed effects

#### Scenario: Content change with unchanged storage
- **WHEN** the target changes only reducer, coordination, constants or lifecycle envelope code, edits or adds snapshot schemas, or adds a lifecycle version
- **THEN** format evidence passes, the target-write/previous-reopen test passes in both upgrade and rollback directions, and qualification is compatible

#### Scenario: Durable surface change
- **WHEN** a stored-state schema, a lifecycle 1.0 or 1.1 schema, a storage or validator module, an unclassified package module or schema file, or a new Hub SQLite module differs
- **THEN** qualification reports `durable-implementation-unqualified` without executing the changed code, and the operation refuses before stop

#### Scenario: Target leaks a field into storage
- **WHEN** the target's content code writes a session field that the stored-state schema rejects on a path the write/reopen test exercises
- **THEN** qualification reports `durable-reopen-probe-failed` and the operation refuses before stop

#### Scenario: Durable dependency unavailable
- **WHEN** a package, required storage or validator module, or required schema is missing or unreadable in any compared program
- **THEN** qualification reports `durable-implementation-unavailable` and the operation refuses before stop

#### Scenario: Refusal reason is inspectable
- **WHEN** qualification refuses an upgrade or rollback
- **THEN** the refused receipt reports `install-rollback-unqualified` and the operation's evidence file records the specific qualification reason
