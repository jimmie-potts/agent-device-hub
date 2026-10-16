## Purpose

Let one owner independently enable a per-plug maximum continuous-on duration through the Hub's existing tracked device path, with honest outage and recovery limits.

## Requirements

### Requirement: Independent optional maximum-on settings
The Hub SHALL privately persist a positive bounded duration and enabled state separately for each selected plug, independent of weekly schedule settings. New limits SHALL default disabled. Disabling SHALL send no power command. Definitions SHALL survive supported restarts. Invalid/unknown targets, unauthorized mutations and unknown input fields SHALL be refused before storage/effects.

#### Scenario: A limit changes while its schedule remains enabled
- **WHEN** the owner saves or disables one plug's limit
- **THEN** its weekly schedule and the other plug's limit remain unchanged

### Requirement: Conservative continuous-run tracking
The owner SHALL preserve a known observed run start through restart and duration edits. Repeated on commands/readings SHALL not extend the deadline. Fresh off SHALL end the run. An observed external/physical on SHALL participate. Missing/stale/offline observations SHALL never end a run or establish a fresh start. If an enabled limit has fresh on evidence but no trustworthy start, the Hub SHALL attempt off instead of granting a new full duration, including after startup/reconnect.

#### Scenario: Restart after a known run began
- **WHEN** the Hub restarts while the plug is still on
- **THEN** it retains the known earlier start and original elapsed run rather than assigning another full duration

#### Scenario: Unknown elapsed time after recovery
- **WHEN** an enabled limit encounters fresh on evidence with no trustworthy start
- **THEN** it requests off through the designated owner and shows unknown elapsed time separately from the attempt/outcome

#### Scenario: Duration is shortened during a run
- **WHEN** an enabled limit is shortened below the known elapsed run
- **THEN** the original start is retained and the next eligible evaluation attempts off

### Requirement: One tracked off attempt and no automatic replay
Expiry SHALL use the existing core tracked power dispatcher and owning module queue, with fresh configuration/generation/availability/capability checks and durable attempt identity. Disabling/editing SHALL fence obsolete callbacks. An admitted or uncertain attempt SHALL not be resent automatically, including across restart. An unavailable/held plug SHALL remain truthfully blocked. No schedule SHALL continuously turn a plug back on after an early maximum-on off.

#### Scenario: Expiry within an active weekly window
- **WHEN** a limit turns a lamp off before its weekly off boundary
- **THEN** no automatic re-on occurs within that window and the next weekly boundary remains planned

#### Scenario: An off attempt is uncertain and the Hub restarts
- **WHEN** the previous limit attempt may have reached the plug
- **THEN** its identity remains retained, the original action is not replayed and the UI does not claim observed off without evidence

### Requirement: Authenticated controls and honest Hub dependence
Per-plug device controls SHALL expose maximum-on enabled state, duration, known/unknown elapsed start, deadline, enforcement/attempt status and observed power separately. Mutations SHALL recheck existing control/origin authority after bounded body reads. The UI SHALL state that enforcement requires the Hub to run and the plug path to be available; no offline shutoff guarantee SHALL be claimed. Current limit status SHALL follow the core-owned `power-limit/2.0` SDK state family with transactional outbox publication, without a Hub polling path. No live limit SHALL be activated by source delivery or page opening.

#### Scenario: Hub is unavailable at expiry
- **WHEN** the Hub or plug path is unavailable at the deadline
- **THEN** no completed-off guarantee is reported and later recovery uses preserved elapsed/unknown-run policy without a new full allowance
