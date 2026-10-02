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
