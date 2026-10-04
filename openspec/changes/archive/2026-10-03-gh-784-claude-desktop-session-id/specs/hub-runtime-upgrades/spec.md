## MODIFIED Requirements

### Requirement: Trusted release and compatible recovery

Every new target MUST have a clean merged full source identity, trusted archive and manifest hashes, verified safe inventory and dependency closure. Before outage, the command MUST prove previous-release compatibility with all durable data the target can write using format evidence and an isolated write/reopen test. Unknown or incompatible recovery MUST refuse.

Format evidence SHALL require the durable surface of the installer, the previous release and the target to be byte-identical, ignoring file modes. The durable surface is the Hub storage adapter, automation store and automation modules and the validators they apply to stored rows; any other Hub module that imports `node:sqlite` apart from the named read-only state capture and migration lease; the agent-state durable validator and identity-key modules; every agent-state schema except snapshot schemas; every lifecycle module except a separately loaded newer-version module that the updater lists as content, such as the lifecycle 1.2 module; and the lifecycle 1.0 and 1.1 schemas. Agent-state and lifecycle files that the updater does not classify as non-durable MUST count as durable. Reducer, provider, retention, snapshot (including the snapshot 1.3 validator), coordination and constants modules and newer lifecycle schema files are outside the surface. The lifecycle root module stays durable because stored-session validation calls it. Because the Hub imports the durable validator through the agent-state entrypoint, the write/reopen test MUST require that entrypoint to export the fingerprinted validator functions in both releases. The test MUST cover the stored session metadata and a known parent as well as the existing record kinds.

#### Scenario: Provenance or compatibility refusal
- **WHEN** source is dirty, archive bytes differ, a path escapes its release, same-SHA bytes conflict or recovery compatibility is unknown
- **THEN** the command refuses without stopping the installed owner

#### Scenario: Latest durable records survive recovery
- **WHEN** the target writes newer identities, revisions, labels, notices, acknowledgments, rules, settings or consumed-event history and recovery runs
- **THEN** the previous program reopens the latest state without restoring an older database or repeating consumed effects

#### Scenario: Content change with unchanged storage
- **WHEN** the target changes only reducer, coordination or constants code, edits or adds snapshot schemas, or adds a lifecycle schema file
- **THEN** format evidence passes, the target-write/previous-reopen test passes in both upgrade and rollback directions, and qualification is compatible

#### Scenario: Durable surface change
- **WHEN** a stored-state schema, a lifecycle 1.0 or 1.1 schema, a lifecycle module other than a listed version module, a storage or validator module, an unclassified package module or schema file, or a new Hub SQLite module differs
- **THEN** qualification reports `durable-implementation-unqualified` without executing the changed code, and the operation refuses before stop

#### Scenario: Separately loaded lifecycle version module
- **WHEN** a target adds or changes the listed lifecycle 1.2 module or the snapshot 1.3 validator while the lifecycle root module stays byte-identical
- **THEN** format evidence passes, while any change to the lifecycle root module still reports `durable-implementation-unqualified`

#### Scenario: Entrypoint rebinds the durable validator
- **WHEN** either release's agent-state entrypoint exports a validator function other than the one in its durable validator module
- **THEN** qualification reports `durable-reopen-probe-failed` and the operation refuses before stop

#### Scenario: Target leaks a field into storage
- **WHEN** the target's content code writes a session field that the stored-state schema rejects on a path the write/reopen test exercises
- **THEN** qualification reports `durable-reopen-probe-failed` and the operation refuses before stop

#### Scenario: Durable dependency unavailable
- **WHEN** a package, required storage or validator module, or required schema is missing or unreadable in any compared program
- **THEN** qualification reports `durable-implementation-unavailable` and the operation refuses before stop

#### Scenario: Refusal reason is inspectable
- **WHEN** qualification refuses an upgrade or rollback
- **THEN** the refused receipt reports `install-rollback-unqualified` and the operation's evidence file records the specific qualification reason
