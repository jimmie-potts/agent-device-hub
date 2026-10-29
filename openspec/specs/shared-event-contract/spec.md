# Shared event contract Specification

## Purpose

Define a language-neutral shared event profile and reference delivery rules without replacing existing runtime contracts or claiming deployed transport guarantees.

## Requirements

### Requirement: Versioned bounded event profile

The contract SHALL define a CloudEvents 1.0 structured JSON profile with required identity, source, event type, profile/schema/content metadata and a registered typed payload. It SHALL reject unknown versions, fields, incompatible type/payload/source-class combinations and inputs exceeding declared byte/depth/node bounds. TypeScript and Python SHALL process the same valid and invalid fixtures with identical outcomes.

#### Scenario: Unsupported or excluded data
- **WHEN** an input has an unsupported schema, an undeclared field or a credential/content field
- **THEN** both validators reject it with a fixed safe error and no side effect

#### Scenario: Cross-language numeric limits
- **WHEN** payload revisions range through the nonnegative safe-integer maximum
- **THEN** both validators preserve that range without representing revisions as CloudEvents integer context attributes

### Requirement: Qualified evidence and stable retry identity

Event identity SHALL be the source-qualified record identity retained across retries. Correlation and causation SHALL distinguish unknown from qualified references. Known occurrence time SHALL remain separate from observation and receipt time; unknown order SHALL remain unknown. Known order SHALL name its authority, epoch and bounded safe-integer sequence. A local record ID SHALL NOT manufacture native provider identity or order.

#### Scenario: Unordered provider observation
- **WHEN** a source adapter assigns a record ID to a hook lacking qualified native identity or order
- **THEN** the reference preserves unknown native identity/order and does not infer occurrence time from receipt

#### Scenario: Retry versus independent event
- **WHEN** an identical record is delivered again with the same source and ID
- **THEN** the reference identifies a duplicate within its declared deduplication scope, while different content for that identity is a conflict

### Requirement: Distinct delivery classes

Current-state delivery SHALL permit coalescing and recover from an authoritative latest snapshot. Recoverable actionable notification delivery SHALL begin only after confirmed durable acceptance, tolerate duplicates and distinguish delivery acknowledgment, human handling and explicit expiry. Live-only effects SHALL require a valid time window and SHALL NOT replay after restart/reconnect. Policies SHALL name finite capacity, saturation, retries, deduplication scope and observable pending/failed outcomes; no rule SHALL promise exactly-once delivery or lossless hook capture.

#### Scenario: Snapshot recovery
- **WHEN** a status cursor is lost or a consumer reconnects
- **THEN** recovery reads current state and neither reconstructs complete history nor replays device effects

#### Scenario: Durable notification boundary
- **WHEN** upstream capture is unconfirmed or an accepting commit has failed or is ambiguous
- **THEN** recoverable delivery is not claimed; a confirmed accepted item remains recoverable until handled or explicitly expired under its owning policy

#### Scenario: Delivery acknowledgment is not human handling
- **WHEN** a notification consumer acknowledges transport delivery
- **THEN** the reference does not mark the notification read or handled and retains its recovery obligation

#### Scenario: Expired effect
- **WHEN** an effect is outside its validity window or encountered during historical recovery
- **THEN** no new effect is authorized

### Requirement: Staged compatibility and ownership

The profile SHALL preserve released lifecycle/controller bytes and distinguish commands, committed state, observations, request outcomes and physical evidence. The interface inventory SHALL identify producer/consumer ownership, schema/version, authority, ordering, bounds, delivery/recovery and adoption classification for every scoped current interface. Hooks SHALL remain bounded and fail open; slow consumers SHALL NOT block intake or healthy consumers. A schema SHALL NOT substitute for authentication, source authorization, the state owner or designated device queues.

#### Scenario: Existing consumer
- **WHEN** an existing lifecycle, snapshot or controller consumer validates its released contract
- **THEN** adding the event profile does not replace that artifact or change its accepted wire input

#### Scenario: Independent outcomes
- **WHEN** one controller reports a transmission and another fails
- **THEN** neither outcome changes the other or establishes visible physical success

### Requirement: Notification recovery assessment

The source definition SHALL assess current retained-notice storage, acknowledgment, capacity, session removal and snapshot recovery. It SHALL return a concrete refinement proposal covering supported sources, retention/expiry, acknowledgment, capacity and recovery, explicitly leaving future policy choices and implementation to their owner.

#### Scenario: Existing notice disappears with session
- **WHEN** current session expiry or accepted runtime retirement removes retained notices
- **THEN** the assessment identifies the limit rather than describing those notices as a general recoverable actionable-notification service

### Requirement: Lighting layout metadata families

Profile 2.0 SHALL define `lighting-layout` state and `lighting-layout-set` command families for the core's private lighting composition. The state SHALL identify its entity and revision and carry bounded room definitions, device-to-room assignments, per-view custom groups and Home selections. The command SHALL identify the request, require an expected revision and carry the complete replacement layout. Closed schemas and semantic validation SHALL reject duplicate identities, invalid references, excessive membership and malformed values. These families SHALL contain no device addresses, credentials or executable behavior.

#### Scenario: Valid saved composition
- **WHEN** a current layout and a correctly guarded replacement command are validated
- **THEN** both use profile 2.0, the core is the single state owner, and the command describes metadata only

#### Scenario: Invalid replacement layout
- **WHEN** a replacement has duplicate room/group identities, invalid room references, overlapping same-view group membership or an undeclared field
- **THEN** validation refuses it before a save or device effect

### Requirement: Playback layout metadata families

Profile 2.0 SHALL define core-owned playback-layout state and playback-layout-set command families for bounded explicit music-card placements. State SHALL identify the playback layout and its revision and carry bounded logical playback IDs and room IDs. The command SHALL identify its request, require an expected revision and carry the complete replacement placement metadata. Closed schemas and semantic validation SHALL reject duplicate identities, duplicate room membership, malformed IDs and excessive membership. These families SHALL contain no room names, speaker addresses, credentials, media or executable behavior. Saves SHALL use operator authority, expiry and revision guards and commit private state with its tracked outcome before publication. Layout outcomes SHALL establish metadata effects only, never audio routing or playback effects, and an uncertain command SHALL never be replayed.

#### Scenario: Valid placement and conflicting replacement
- **WHEN** an authorized current-revision replacement is admitted, followed by an obsolete-revision replacement
- **THEN** only the first layout commits with its outcome, the obsolete request is refused revision-conflict, and neither sends a playback command

#### Scenario: Invalid or interrupted placement
- **WHEN** a request contains invalid or duplicate membership, lacks operator admission, expires before saving or fails storage before commit
- **THEN** the existing typed refusal leaves committed state unchanged; a lost reply retains uncertainty until reconciled and never causes automatic resend

### Requirement: Desktop metadata family

The contract SHALL register the `desktop-metadata` occurrence family (Hub #567): type `org.bunny.desktop-metadata.observed`, dataschema `https://bunny.invalid/events/desktop-metadata/2.0`, on `bunny.event.desktop-metadata.<feed ID>`, where the feed ID is the lowercase hex SHA-256 of the feed's sorted `client`, `hostId`, `provider` and `sourceId` in UTF-8 JSON and the envelope's subject SHALL be that ID. Its payload SHALL be exactly `feed` (`provider: codex`, `client: desktop`, `hostId`, `sourceId`), `observedAtMs` (the collector's clock at its read), `stamp` (1 to 64 letters, digits, dots, colons, underscores or hyphens), `unread` (at most 4096 distinct IDs, or null), `archived` (at most 2048 distinct IDs, or null) and `titles` (at most 512 entries with distinct IDs, each a provider title). The TypeScript validator SHALL accept and refuse the family's fixtures; as for the other 2.0 families, no Python mirror exists, and the Python check covers the 1.x profile only. The core SHALL take no session change from the family.

#### Scenario: Valid and invalid snapshots
- **WHEN** a snapshot has the feed's subject, bounded distinct sets and provider titles, and others have a wrong subject, a `local` client, 4097 unread IDs, a duplicate archive ID, a user title, an extra member or no stamp
- **THEN** the validator accepts the first and rejects each of the others with a fixed safe error
