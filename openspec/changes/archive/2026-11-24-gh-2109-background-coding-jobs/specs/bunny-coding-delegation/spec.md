## ADDED Requirements

### Requirement: Durable coding job ownership

Companions SHALL save the job ID, originating conversation and exchange, approved repository and brief, and attempt operation ID before dispatch. The current dispatcher and worker SHALL continue to use the attempt operation ID. An attempt's terminal status and pending Conversation delivery SHALL be saved together. If that write fails, Companions SHALL retain the first observed terminal evidence while it retries the write. It SHALL NOT send another worker command. A restart without durable terminal evidence SHALL report uncertainty. Duplicate and late progress SHALL only be considered for the attempt they identify.

#### Scenario: Restore after interruption

- **WHEN** Companions restarts with a known unsent job, an ambiguous start, or a saved result pending delivery
- **THEN** the unsent job can dispatch when eligible, the ambiguous start is reported as uncertain without reissue, and the saved result is delivered once

#### Scenario: Stop a named job

- **WHEN** the owner stops one job, or cancels a separate Conversation turn
- **THEN** only the named attempt can receive a stop and an unconfirmed stop does not claim cancellation

## MODIFIED Requirements

### Requirement: Tracked dispatch and one slot per companion

An approved delegation SHALL go from the companions module to the core as `coding-dispatch` and through the core's tracked dispatcher as one `coding-run` operation the module answers. The worker SHALL hold one slot per companion (B.U.N.N.Y., Reachy and MicroDuck) and at most three runs at once, and SHALL refuse a start with `capacity` when that companion's slot or every slot is busy. The module SHALL tag each run with the companion whose task asked, send the worker the start with that companion (`coding-work/2.1`), and send a worker that declared no slots the untagged 2.0 start while counting it as one slot shared by every companion. The module SHALL save its responsibility before sending one `coding-work` start to the worker endpoint, SHALL refuse a dispatch whose companion's slot is busy with `capacity`, and SHALL report the tracked outcome succeeded (observed) when the worker reports it started, failed when the start is refused, and uncertain when no start arrives within twenty seconds. An approved hand-off whose companion's slot is busy, or already has hand-offs waiting, SHALL wait durably, first in first out per slot and at most 32 at once, without being sent; when the slot frees and a worker is selected, the module SHALL send the oldest one once through the core's tracked dispatcher with its own request ID, and a refused or unanswered dispatch SHALL end its wait and reach its task as failed with the code or uncertain, without a retry. Stopping a named unsent job SHALL remove its waiting attempt without sending it. A stop saved before a sending attempt reaches the responder SHALL refuse the worker start when that responder sees it. A pre-change hand-off that still depends on its task SHALL keep the task's cancellation and wait guard. Runs on the same repository at once SHALL each use their own fresh worktree. The worker's completion, failure, cancellation or uncertainty SHALL settle only its own responsibility and reach the original exchange, or the task's saved delegation interrupt for an earlier record without a second tracked outcome; a cancel, a timeout or a lost endpoint SHALL settle only the operations it names or holds. Restart SHALL settle each pending responsibility as uncertain and resend nothing; a waiting hand-off that was never sent SHALL keep its place and be sent when its slot is free, and one whose dispatch had left without its acceptance recorded SHALL end uncertain and never be sent again. Startup settlement SHALL publish the saved evidence without starting a Conversation turn. The coding state (`coding-state/2.2`) SHALL list the selected worker's declared slots, every active run with its companion and status, and the waiting hand-offs, oldest first, and keep `active` as the oldest run. Bounds of twenty minutes, sixty turns and five dollars per task SHALL travel with each dispatch.

#### Scenario: Handed to the worker
- **WHEN** the owner approves a delegation and the worker reports it started
- **THEN** the core's operation completes succeeded with observed evidence, the coding state lists the running task with its companion, and another dispatch for that companion is refused with capacity until the worker reports an end

#### Scenario: Three companions at once
- **WHEN** B.U.N.N.Y., Reachy and MicroDuck each have an approved hand-off for a three-slot worker
- **THEN** three starts reach the worker at once, each tagged with its companion, the coding state lists three runs, and each result reaches only its own task

#### Scenario: A further hand-off waits for its own slot
- **WHEN** a companion's hand-off is approved while that companion's run holds its slot
- **THEN** nothing is sent for it, the coding state lists it as waiting, another companion's run ending sends nothing, and its own slot freeing sends it once

#### Scenario: Cancel a waiting hand-off
- **WHEN** the owner stops a named job whose hand-off has not been sent
- **THEN** its original exchange reports cancellation before dispatch and freeing the slot sends nothing for it

#### Scenario: Restart never resends
- **WHEN** the runtime restarts with a responsibility the worker had not finished and a never-sent waiting hand-off behind it
- **THEN** the responsibility is settled uncertain and its task hears so as a start-time settlement, availability starts off, the waiting hand-off is sent once when a worker declares and its slot is free, and a later enable or restart sends neither again

#### Scenario: Restart with a dispatch on its way
- **WHEN** the runtime stops after a waiting hand-off's dispatch left and before its acceptance was recorded
- **THEN** the next start ends that hand-off uncertain, tells its task as a start-time settlement and never sends it again

#### Scenario: An older worker
- **WHEN** the selected worker declared no slots
- **THEN** it receives untagged 2.0 starts, one run at a time for every companion, and another companion's approved hand-off waits for that run to end
