## ADDED Requirements

### Requirement: Native conversation companions in the core

The core SHALL keep a native session's `companions` from the latest `lifecycle/2.4` observation that names them, under the same newer-metadata guard as its title and label, and SHALL publish them on its record ([Hub #2054](https://github.com/jimmie-potts/agent-device-hub/issues/2054)). An observation without companions, title metadata and an owner's rename SHALL leave them. The stored session SHALL keep them across a restart. The core SHALL bind `lifecycle/2.4` to the native producer as it binds `lifecycle/2.2` and `2.3`, refusing it from any other source with `forbidden`, and the gateway SHALL refuse `lifecycle/2.4` from every edge credential.

#### Scenario: Companions through titles
- **WHEN** the companions module reports a task with Reachy as its companion, then a generated title, then the owner's rename, then a `lifecycle/2.2` observation without companions, and a hook starts a Claude session
- **THEN** each native record is `session/3.2` with Reachy and the title the module sent, with no companion name added, and the Claude record is `session/3.0` without companions

#### Scenario: Restart and replacement
- **WHEN** a native session that names Reachy is stored, the core restarts, an observation names the three Apartment companions and a later one names none
- **THEN** Reachy survives the restart, the three companions replace it, and the last observation leaves them

#### Scenario: Binding
- **WHEN** a hook credential or the Codex Desktop module sends `lifecycle/2.4`, or an edge credential publishes it
- **THEN** the core refuses it with `forbidden` and the gateway refuses it before the bus

## MODIFIED Requirements

### Requirement: Native conversation observations

The core SHALL take `lifecycle/2.2` observations through the same intake and transition as hook observations. The schemas SHALL refuse, as `invalid-message`, a native identity whose host or source ID is not the native constant and a native identity in any lifecycle version before 2.2. The core SHALL refuse with `forbidden` a native observation whose source is not the definition's producer source, an observation from that producer that names another provider, and a `lifecycle/2.2` observation from any other source, and with `invalid-request` a native runtime end; the gateway SHALL refuse every `lifecycle/2.2` observation from an edge credential. `turn-waiting` SHALL make work idle and add no notice; `turn-uncertain` SHALL make work unknown with activity `lost`; a `turn-ended` with a result SHALL keep the result on its notice and clear every attention item of its turn with cause `turn-ended`, and one with result `cancelled` SHALL add its notice acknowledged by every configured consumer. A native session is a conversation and each turn one task in it. An ordered, newer `turn-started` SHALL recover the turn and activity unavailability that a best-effort start recovers, and an ordered observation of the work on the session's turn, other than `turn-uncertain` and newer in the session's ordering epoch than the observation that made the activity `lost`, SHALL settle that `lost` activity; a session whose ordering was not known in that epoch SHALL settle nothing this way. The core SHALL publish each record and occurrence in the lowest version that expresses it: native records as `session/3.1`, or `session/3.2` once they name their companions, and their occurrences as 2.1, every other record as `session/3.0` and its occurrences as 2.0. Native observations SHALL raise no companion opportunity; that exclusion SHALL be the companion part's alone, so a later `companion-opportunity` version can carry native identities.

#### Scenario: Duplicate and late delivery
- **WHEN** a native `turn-started` for task T arrives again after T's `turn-ended`, a question's raise arrives again after its resolution, and T's `turn-ended` arrives after the next task's `turn-started`
- **THEN** each is `stale`, no work revives and no item returns

#### Scenario: An impersonating producer
- **WHEN** a hook credential publishes an observation naming the native provider, and the companions module publishes one naming Claude
- **THEN** the core refuses both with `forbidden`, the gateway refuses the first before the bus when it comes from an edge credential, and no session changes

#### Scenario: The conversation's next task
- **WHEN** a native conversation's task T1 succeeds and its next task T2 starts on the next ordering sequence
- **THEN** the session works on turn T2, T1's notice no longer counts, and the consumers a new turn acknowledges for have acknowledged it

#### Scenario: A resume in the same turn
- **WHEN** a native task's call is left uncertain and the task is then resumed, with `activity-observed` on its own turn
- **THEN** the session's work is `active` and confirmed, with no `lost` activity left

#### Scenario: A late, older work observation
- **WHEN** an ordered `evidence-unavailable` marks a session's activity `lost` at sequence 5 and an `activity-observed` at sequence 3 of the same turn arrives after it
- **THEN** the activity stays `lost` and the work unconfirmed, and only a later `activity-observed` at sequence 6 settles it

#### Scenario: An owner cancel
- **WHEN** a native task waiting on its question is cancelled
- **THEN** the item clears with cause `turn-ended`, the status is `finished` with detail `cancelled`, and the default, dashboard, Nanoleaf and Pixoo policies each show it `quiet` with detail `acknowledged`

#### Scenario: Expiry and reappearance
- **WHEN** a native conversation's task waits on its question for more than a day, the owner then answers it, and after another day without change the next task starts
- **THEN** the session expires at each day without evidence while the conversation keeps its tasks, the answer creates a new working session with a new generation on the same turn, the next task creates another on its own turn, and the ordering sequence keeps counting across both
