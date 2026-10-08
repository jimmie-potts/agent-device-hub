## ADDED Requirements

### Requirement: The core publishes its operation records

The core SHALL serve the `operation` family through its sync and SHALL keep one record per tracked action, its tracker row's copy without the command's payload, as its own first core part. Each change of a tracked action SHALL save the action's record at the core's revision and add its state message to the core's outbox in the transaction that commits the tracker's change, so the record is published after that commit and never apart from it. The tracker's row SHALL stay the authority, and no record SHALL send or resend a command. The core SHALL keep at most `MAX_OPERATION_RECORDS` (256) records: a new action that takes the family past the bound SHALL remove the oldest settled records, in its own transaction, publishing a removal with reason `retired` for each, and SHALL never remove a pending action's record, so a sync of the family stays bounded. The records SHALL outlive a restart, and a pending action's record SHALL turn uncertain at its deadline as its row does. The inbox (#923) SHALL reuse the family by request ID rather than keep another copy of the tracker.

#### Scenario: Requested, accepted and completed
- **WHEN** an action is dispatched, accepted and completed by its outcome, and a reader syncs the `operation` family alone
- **THEN** the core publishes the record `sent`, `accepted`, then `completed` with the outcome's result and evidence, each at a higher revision, a pending record carries no result, and the sync serves the latest record

#### Scenario: Refusals and deadlines
- **WHEN** an action is refused, and another reaches its outcome deadline with no outcome and later completes
- **THEN** the first record is `rejected`, failed with evidence `none` and the owner's code, and the second turns `uncertain` and then `completed` with the late outcome's evidence, and nothing is sent again

#### Scenario: The bound
- **WHEN** the bound is two, one action is pending, and three more complete
- **THEN** the two oldest settled records are removed as `retired`, the pending one stays though it is the oldest, and a sync serves the pending one and the newest

#### Scenario: A restart
- **WHEN** the runtime restarts with one completed action and one pending, and the pending action's deadline passes
- **THEN** a sync after the restart serves both records, and the pending one turns `uncertain` with nothing sent again

#### Scenario: Tier 1
- **WHEN** the catalog's `operation-records` scenario runs over both transports
- **THEN** a lamp switch the lamp holds shows `sent` with no result in the reader's copy, completes with the lamp's observation once released, the core published it `sent` first and `completed` last, and a failed switch says nothing reached the lamp

### Requirement: The module list names what each module serves

`GET /api/v2/modules` SHALL list for each module `serves`, the families it serves through sync now, as health lists them, when it serves any, so a browser, which cannot read health, learns the owners of a family that several modules serve (Hub #922).

#### Scenario: The same families as health
- **WHEN** a reader lists the modules of a runtime with the core and the configured sign
- **THEN** each module's `serves` equals its health entry's, the core's includes `operation` and the sign's `device`
