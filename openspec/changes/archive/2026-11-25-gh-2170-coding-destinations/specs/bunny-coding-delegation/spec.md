## ADDED Requirements

### Requirement: Source-bound execution destination

The Hub SHALL select each new coding attempt against its requested destination and harness, permitted disclosure, authorized repository and revision, execution requirements and current worker declarations. The Hub SHALL preserve existing single-Mac jobs and uncapped coding admission.

#### Scenario: Route a coding step
- **WHEN** several enrolled workers can run the requested repository revision and harness
- **THEN** the Hub considers resource pressure, capacity and quota evidence, breaks equal ranks by stable destination identity and records the deciding fact.

#### Scenario: Respect a pin or resource requirement
- **WHEN** the owner pins a destination or the approved operation requires a platform, test resource, authorized device route, proximity or designated installation operator
- **THEN** the Hub requires every constraint and current sharing permission, and reports eligible alternatives if the pin is unavailable.
- **AND** worker advertisements and repository text cannot confer device or installation authority.

#### Scenario: A worker loses its connection
- **WHEN** a selected worker goes stale or disconnects
- **THEN** the Hub refuses an unsent start and preserves uncertainty for an attempt that may have started; an unrelated worker retains its own controls.

#### Scenario: Preserve attempt provenance
- **WHEN** an owner opens Conversation or Jobs after restart
- **THEN** the original request, selected destination, harness and reason remain attached to the attempt where recorded; missing historical fields stay unknown.
- **AND** continuation and native handoff require the original writer's release, proven checkout and exact live selection; unsupported cross-host transfer is explained.

#### Scenario: Current Mac rollout
- **WHEN** the established Mac connects using its original credential and declaration
- **THEN** it remains eligible for its existing authorized work; a fresh destination requires its own enrolled source, visible capabilities and permission to receive the brief.

## MODIFIED Requirements

### Requirement: Worker credential and endpoint

A coding worker SHALL act through a credential with the `coding-worker` role, bound to its enrolled Mac, PC or cloud worker source with no ordinary scope. The established Mac SHALL retain `bunny/parts/coding-worker`. Each destination SHALL have at most one selected connection. The edge SHALL grant that credential exactly one connection-bound endpoint: answering `coding-work`, publishing `coding-progress` and requesting `coding-endpoint`, with no subscription, sync, operator command or other publication. The worker SHALL declare its availability explicitly after connecting, and a worker from Hub #2028 SHALL declare its three slots with it (`coding-endpoint/2.2`); a lost connection SHALL be reported by the gateway as `coding-lost`, and reconnecting SHALL require a fresh declaration. When its endpoint closes, the worker SHALL stop every run that endpoint started, including one whose tool starts after the stop, keep each under its original operation identity, where a cancel or a stop still reaches it, until it ends, declare its next endpoint once they have ended or after a bound of fifteen seconds, after which a run still alive keeps only its own companion's slot busy on a finite worker, and send no report of those runs on another endpoint. The gateway SHALL refuse any direct dispatch of a `coding-*` family.

#### Scenario: Endpoint-only authority
- **WHEN** a credential carries the coding-worker role
- **THEN** it may answer work, publish progress and declare its endpoint, and it is refused every state read, sync, device command and other publication

#### Scenario: Lost worker
- **WHEN** the worker's connection closes while operations are running
- **THEN** the gateway reports the endpoint lost, each operation that may have reached that endpoint ends uncertain on its own and its task is told so, and no second start is sent

#### Scenario: Slots free on the next endpoint
- **WHEN** a finite worker's endpoint closes with three runs, one of whose tools starts only after the close
- **THEN** that tool is stopped as it starts, no second start for its companion is taken while it lives, the fresh endpoint is declared once the stopped runs have ended and accepts a start for each companion, and no report of a stopped run goes out on it

#### Scenario: A stopped run that never ends
- **WHEN** a finite worker's stopped run output stays held open by a leftover process
- **THEN** the worker declares its fresh endpoint after the bound, refuses that companion's start with `capacity` until the run ends, and accepts the other companions' starts

### Requirement: Tracked dispatch and one slot per companion

An approved delegation SHALL go from the companions module to the core as `coding-dispatch` and through the core's tracked dispatcher as one `coding-run` operation the module answers. A worker using the finite three-slot declaration SHALL hold one slot per companion (B.U.N.N.Y., Reachy and MicroDuck) and at most three runs at once, and SHALL refuse a start with `capacity` when that companion's slot or every slot is busy. The module SHALL tag each run with the companion whose task asked, send the worker the start with that companion (`coding-work/2.1`), and send a legacy worker that declared neither capacity nor slots the untagged 2.0 start while counting it as one slot shared by every companion. The module SHALL save its responsibility before sending one `coding-work` start to the worker endpoint, SHALL refuse a dispatch whose finite slot is busy with `capacity`, and SHALL report the tracked outcome succeeded (observed) when the worker reports it started, failed when the start is refused, and uncertain when no start arrives within twenty seconds. On a finite endpoint, an approved hand-off whose companion's slot is busy, or already has hand-offs waiting, SHALL wait durably, first in first out per slot and at most 32 at once, without being sent; when the slot frees and a worker is selected, the module SHALL send the oldest one once through the core's tracked dispatcher with its own request ID, and a refused or unanswered dispatch SHALL end its wait and reach its task as failed with the code or uncertain, without a retry. Stopping a named unsent job SHALL remove its waiting attempt without sending it. A stop saved before a sending attempt reaches the responder SHALL refuse the worker start when that responder sees it. A pre-change hand-off that still depends on its task SHALL keep the task's cancellation and wait guard. Runs on the same repository at once SHALL each use their own fresh worktree. The worker's completion, failure, cancellation or uncertainty SHALL settle only its own responsibility and reach the original exchange, or the task's saved delegation interrupt for an earlier record without a second tracked outcome; a cancel, a timeout or a lost endpoint SHALL settle only the operations it names or holds. Restart SHALL settle a pending responsibility as uncertain when its start may have been sent or its send evidence is unknown. A responsibility pinned to a lost connection and durably known never to have sent its worker start SHALL fail as unavailable. Neither case SHALL resend a start; a waiting hand-off that was never sent SHALL keep its place and be sent when its slot is free, and one whose dispatch had left without its acceptance recorded SHALL end uncertain and never be sent again. Startup settlement SHALL publish the saved evidence without starting a Conversation turn. For finite endpoints within the legacy state bounds, `coding-state/2.2` SHALL list the selected worker's declared slots, every active run with its companion and status, and the waiting hand-offs, oldest first, and keep `active` as the oldest run. Bounds of twenty minutes, sixty turns and five dollars per task SHALL travel with each dispatch.

#### Scenario: Handed to the worker
- **WHEN** the owner approves a delegation and a finite worker reports it started
- **THEN** the core's operation completes succeeded with observed evidence, the coding state lists the running task with its companion, and another dispatch for that companion is refused with capacity until the worker reports an end

#### Scenario: Three companions at once
- **WHEN** B.U.N.N.Y., Reachy and MicroDuck each have an approved hand-off for a three-slot worker
- **THEN** three starts reach the worker at once, each tagged with its companion, the coding state lists three runs, and each result reaches only its own task

#### Scenario: A further hand-off waits for its own slot
- **WHEN** a companion's hand-off on a finite worker is approved while that companion's run holds its slot
- **THEN** nothing is sent for it, the coding state lists it as waiting, another companion's run ending sends nothing, and its own slot freeing sends it once

#### Scenario: Cancel a waiting hand-off
- **WHEN** the owner stops a named job whose hand-off has not been sent
- **THEN** its original exchange reports cancellation before dispatch and freeing the slot sends nothing for it

#### Scenario: Restart never resends
- **WHEN** the runtime restarts with a responsibility whose start may have reached the worker and a never-sent waiting hand-off behind it
- **THEN** the responsibility is settled uncertain and its task hears so as a start-time settlement, availability starts off, the waiting hand-off is sent once when a worker declares and its slot is free, and a later enable or restart sends neither again

#### Scenario: Restart with a dispatch on its way
- **WHEN** the runtime stops after a waiting hand-off's dispatch left and before its acceptance was recorded
- **THEN** the next start ends that hand-off uncertain, tells its task as a start-time settlement and never sends it again

#### Scenario: An older worker
- **WHEN** the selected legacy worker declared neither capacity nor slots
- **THEN** it receives untagged 2.0 starts, one run at a time for every companion, and another companion's approved hand-off waits for that run to end
