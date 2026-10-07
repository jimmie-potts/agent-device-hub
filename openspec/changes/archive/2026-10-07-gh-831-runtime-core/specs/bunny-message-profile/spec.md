## MODIFIED Requirements

### Requirement: Notice acknowledgment

The profile SHALL define `notice-acknowledge`, a core command sent as `org.bunny.notice.acknowledge.requested` with a `requestId`, a `consumerId` and a SHA-256 `noticeId`. Its envelope subject SHALL be the session's entity ID. A consumer SHALL send it to the core to acknowledge one turn-ended notice for its own consumer ID. The core SHALL add that consumer to the notice's `acknowledgedBy`. Acknowledgments are recorded per consumer, and each consumer's policy SHALL decide which acknowledgments clear what it shows, as today. An acknowledgment SHALL NOT be taken as readership, success or a cleared attention item. A consumer SHALL acknowledge for its own consumer ID only: the core SHALL refuse an acknowledgment whose sender's source does not end in that consumer ID with `forbidden`. The core SHALL reply `accepted` for an acknowledgment it recorded or had recorded, `not-found` for an unknown session or notice, `invalid-request` for a consumer it does not record acknowledgments for, and `capacity` when its store is full. It SHALL commit the acknowledgment before it replies, and SHALL publish the session record at a new revision, in the command's trace, and no outcome. Its reply SHALL use the profile's payload.

#### Scenario: A consumer acknowledges a notice
- **WHEN** Pixoo sends `notice-acknowledge` for a session's notice with its own consumer ID, and the core accepts it
- **THEN** the command and the reply are valid, and a reply refusing an unknown notice carries a registered error code

#### Scenario: Acknowledgment rules
- **WHEN** an acknowledgment names a subject that is not a session ID, including one of 63 hexadecimal characters, a neutral notice ID that is not a SHA-256 hash, no consumer or a read state, or is sent as an occurrence or as a `lifecycle` event
- **THEN** it is refused with `invalid-message`

#### Scenario: Another consumer's acknowledgment
- **WHEN** the Nanoleaf module sends `notice-acknowledge` for Pixoo's consumer ID, and then Pixoo acknowledges for itself twice
- **THEN** the first is `forbidden` and changes nothing, Pixoo's is `accepted` and records Pixoo alone at a new revision, and the repeat is `accepted` and changes nothing

### Requirement: Occurrence families

Agent occurrences SHALL name the session's `id` and identity, the observation's turn, instants and ordering and the owner revision that committed them. `attention-raised` and `attention-cleared` SHALL carry the whole attention item: its ID, its kind and the turn it was raised on. A raised item's turn SHALL be the observation's turn. A cleared item's turn MAY differ from it, as when a newer turn retires the item's turn. `attention-cleared` SHALL name its cause: `resolved`, `turn-ended`, `turn-retired` or `recovered`. `turn-ended` MAY name the retained notice. `session-ended` SHALL precede the removals of the retired records. A clearing that no observation started, an explicit approval recovery (`recovered`) or the startup settlement of approvals on retired turns (`turn-retired`), SHALL carry the session's current turn when the owner cleared the item, the owner's instant of the change as `observedAtMs`, unknown ordering and no `occurredAtMs`. `moment-ended` SHALL name the request, the moment, its ending (`completed`, `preempted`, `superseded` or `interrupted`) and its instant.

#### Scenario: Occurrence rules
- **WHEN** an occurrence names a session `id` that is not its identity's key, uses another subject, names ordering under another authority, raises an item on a turn other than the observation's, or gives an unknown clearing cause or moment ending
- **THEN** it is refused with `invalid-message`

#### Scenario: An approval from an earlier turn
- **WHEN** a `turn-started` observation selects turn T2 and retires turn T1, which holds an approval without a request ID
- **THEN** `attention-cleared` names the observation's turn T2, the item's turn T1 and cause `turn-retired`, and is accepted

#### Scenario: An owner-started clearing
- **WHEN** the owner recovers an approval without a request ID explicitly, or settles one on a retired turn at startup
- **THEN** `attention-cleared` with cause `recovered` or `turn-retired` names the session's current turn, the owner's instant and unknown ordering, and is accepted
