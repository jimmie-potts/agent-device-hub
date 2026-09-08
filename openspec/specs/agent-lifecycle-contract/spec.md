# Agent lifecycle contract

## Purpose

Provide portable lifecycle observations with explicit identity, privacy, uncertainty and consumer-policy boundaries for shared agent monitoring.

## Requirements

### Requirement: Qualified provider evidence

The contract SHALL distinguish documented, observed, unsupported and inaccessible capabilities for versioned Codex Desktop, Codex CLI and Claude Code Windows/WSL paths. Required-client enablement SHALL stop when mandatory identity, privacy or bounded observational delivery cannot be established.

#### Scenario: Installed artifact without a live session
- **WHEN** a package version and its documentation are accessible but no client session has been qualified
- **THEN** the evidence matrix identifies artifact and documented evidence and leaves live compatibility pending

### Requirement: Strict versioned metadata

The contract SHALL validate a bounded versioned envelope containing provider/client, neutral host/source/session identity, available turn identity, event identity or deterministic fallback, event kind and observation time. Unknown fields, incompatible versions, private payload fields and malformed values SHALL be rejected with content-free errors.

#### Scenario: Privacy canary
- **WHEN** an otherwise valid event contains a prompt, transcript, tool result, copied title, credential or private path field
- **THEN** no validated event or content-bearing error is returned

#### Scenario: Unsupported version and excessive input
- **WHEN** the wire version is unsupported or input exceeds size/depth bounds
- **THEN** both language consumers reject it without exposing input content

### Requirement: Independent session and evidence dimensions

Activity, continuing question, blocked input/approval, resolution, turn-ended notice, interruption, runtime end, acknowledgment, optional read evidence and observation freshness SHALL retain distinct meanings. Turn end SHALL prove neither success nor readership. Monitor acknowledgment SHALL identify the consumer and notice without modifying provider read state.

#### Scenario: Continuing question and turn end
- **WHEN** a continuing-question observation is followed by turn end
- **THEN** the contract identifies continuing attention separately from the turn-ended notice and asserts neither success nor readership

#### Scenario: Optional read evidence
- **WHEN** a consumer receives no qualified provider read evidence
- **THEN** readership remains unknown, and Pixoo dismissal remains monitor-only while legacy Nanoleaf policy is preserved

### Requirement: Evidenced identity and ordering

Concurrent sessions in one project SHALL remain separate. Only evidenced children SHALL identify a parent. Missing parent, turn or sequence evidence SHALL remain explicit. Deduplication SHALL use a native event ID or deterministic key derived solely from validated metadata; identical fallback observations SHALL retain their ambiguity.

#### Scenario: Concurrent sessions and unknown child
- **WHEN** two sessions share a chosen project label and another event lacks parent evidence
- **THEN** their identity selectors remain distinct and the unknown event is not attributed to either parent

#### Scenario: Retry and late old-turn event
- **WHEN** an identical observation is retried or an old-turn event arrives after a new turn
- **THEN** retries retain the same deduplication key and turn/ordering evidence remains available for the future reducer without inferring order from arrival

### Requirement: Bounded observational producer contract

Producers SHALL allowlist before delivery, retain finite payload/queue/process/deadline bounds, drop or report loss safely on overflow and exit without permission decisions or agent-facing output during collector failure. No monitoring path SHALL wait on devices or modify an agent action. Measured numeric budgets SHALL be frozen by Hub #30 before runtime implementation.

#### Scenario: Collector outage or async backlog
- **WHEN** collection is unavailable or provider async delivery accumulates queued invocations
- **THEN** the producer contract requires bounded work and silent fail-open return independent of device or consumer state, with no claim that provider async alone meets the bound

### Requirement: Portable released contract

Schemas, fixtures and TypeScript/Python consumers SHALL ship together with version and file hashes. Separate repositories SHALL consume a checksum-pinned archive from a reviewed merged revision without checkout-relative imports.

#### Scenario: Isolated archive consumer
- **WHEN** the archive is installed outside the source checkout
- **THEN** both consumers validate the complete shared corpus and integrity manifest with the same results
