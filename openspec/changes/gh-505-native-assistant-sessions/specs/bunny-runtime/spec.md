## ADDED Requirements

### Requirement: Native task observations

The core SHALL take `lifecycle/2.2` observations through the same intake and transition as hook observations. It SHALL refuse with `forbidden` an observation that names the native provider unless its source is the definition's producer source and its host and source IDs are the native constants, an observation from that producer that names another provider, and a `lifecycle/2.2` observation from any other source; the gateway SHALL refuse a native identity from every edge credential. `turn-waiting` SHALL make work idle and add no notice; `turn-uncertain` SHALL make work unknown with activity `lost`; a `turn-ended` with a result SHALL keep the result on its notice and clear every attention item of its turn with cause `turn-ended`, and one with result `cancelled` SHALL add its notice acknowledged by every configured consumer. An ordered, newer `turn-started` SHALL recover the turn and activity unavailability that a best-effort start recovers. The core SHALL publish each record and occurrence in the lowest version that expresses it: native records as `session/3.1` and their occurrences as 2.1, every other record as `session/3.0` and its occurrences as 2.0. Native observations SHALL raise no companion opportunity; that exclusion SHALL be the companion part's alone, so a later `companion-opportunity` version can carry native identities.

#### Scenario: Duplicate and late delivery
- **WHEN** a native `turn-started` for run R arrives again after R's `turn-ended`, and a question's raise arrives again after its resolution
- **THEN** both are `stale`, no work revives and no item returns

#### Scenario: An impersonating producer
- **WHEN** a hook credential publishes an observation naming the native provider, and the companions module publishes one naming Claude
- **THEN** the gateway refuses the first and the core refuses both with `forbidden`, and no session changes

#### Scenario: An owner cancel
- **WHEN** a native task waiting on its question is cancelled
- **THEN** the item clears with cause `turn-ended`, the status is `finished` with detail `cancelled`, and the default, dashboard, Nanoleaf and Pixoo policies each show it `quiet` with detail `acknowledged`

#### Scenario: Expiry and reappearance
- **WHEN** a native task waits on its question for more than a day and the owner then answers it
- **THEN** its session expires at a day without evidence while the task keeps its question, and the answer creates a new working session with a new generation

### Requirement: Native tasks under the session limit

Each assistant task SHALL count as one root session of the native source under the shared limit. At the limit a new native root SHALL displace one finished child subtree without attention, or be refused with `capacity` silently to the producer; a native root SHALL never be displaced. A refused task SHALL appear at its next reported change once there is room.

#### Scenario: Native roots at the limit
- **WHEN** the core holds 128 sessions with one finished child subtree, and two native tasks and a Claude root start
- **THEN** the first native task displaces the subtree, the second task and the Claude root are refused with `capacity`, the module's task changes all commit, and the refused task appears at its next change after a session expires
