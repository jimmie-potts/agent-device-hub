## ADDED Requirements

### Requirement: The core publishes its operation records

The core SHALL serve the `operation` family through its sync and SHALL keep one record per tracked action, its tracker row's copy without the command's payload, as its own first core part. Each change of a tracked action SHALL save the action's record at the core's revision and add its state message to the core's outbox in the transaction that commits the tracker's change, so the record is published after that commit and never apart from it. The tracker's row SHALL stay the authority, and no record SHALL send or resend a command. After every tracked change, including settlement and late outcomes, the core SHALL remove the oldest settled projections by `sent_at_ms, id` until at most `MAX_OPERATION_RECORDS` (256) records remain or all remaining records are pending, publishing a removal with reason `retired` for each in the change's transaction. Pending records SHALL survive even above the limit. Projection retirement SHALL never delete tracker or history rows. State and removal messages SHALL retain the incoming outcome's trace when present, or the stored action's trace otherwise. The records SHALL outlive a restart, and a pending action's record SHALL turn uncertain at its deadline as its row does. The inbox (#923) SHALL reuse the family by request ID rather than keep another copy of the tracker.

#### Scenario: Requested, accepted and completed
- **WHEN** an action is dispatched, accepted and completed by its outcome, and a reader syncs the `operation` family alone
- **THEN** the core publishes the record `sent`, `accepted`, then `completed` with the outcome's result and evidence, each at a higher revision, a pending record carries no result, and the sync serves the latest record

#### Scenario: Refusals and deadlines
- **WHEN** an action is refused, and another reaches its outcome deadline with no outcome and later completes
- **THEN** the first record is `rejected`, failed with evidence `none` and the owner's code, and the second turns `uncertain` and then `completed` with the late outcome's evidence, and nothing is sent again

#### Scenario: The bound
- **WHEN** the bound is two, one action is pending, and three more complete
- **THEN** the two oldest settled records are removed as `retired`, the pending one stays though it is the oldest, and a sync serves the pending one and the newest

#### Scenario: Settlement after pending excess
- **WHEN** three actions are pending with a limit of two, the oldest settles without a new dispatch, and a later outcome advances its retired tracker row
- **THEN** all pending rows initially survive, settlement restores two projections, the old late update is retired again, and tracker/history rows and command counts remain unchanged by projection retirement

#### Scenario: Atomic failure and delayed publication
- **WHEN** a full disk or a later core part refuses a tracked transaction, or publication is refused after commit and the runtime restarts
- **THEN** a refused transaction changes no tracker, projection, history or outbox row and publishes no state or acknowledgment; a committed projection is readable through sync, and its stored messages publish after restart with unchanged identity, time and trace, without resending any command

#### Scenario: Expired and conflicting outcomes
- **WHEN** a command expires while queued, or succeeded and failed outcomes arrive in either order and one outcome is retransmitted unchanged
- **THEN** the queued action is expired and failed with no effect evidence, conflicting results publish conflict with the strongest evidence, and an exact duplicate changes no operation record or revision and sends no command

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

#### Scenario: Modules without a current sync registration
- **WHEN** a module is refused at admission, fails before serving, runs without serving a family, or fails after it served one
- **THEN** the module's state remains listed, `serves` is omitted while it has no current sync registration, and its served-family description matches health

#### Scenario: Authenticated operation reads
- **WHEN** a read credential or a signed-in browser reads the operation family and a reader requests its snapshot
- **THEN** the routes serve the latest records without dispatching an action, and an unauthenticated family read is refused
