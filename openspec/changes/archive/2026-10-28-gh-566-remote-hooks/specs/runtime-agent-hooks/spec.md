## ADDED Requirements

### Requirement: Explicit qualified private HTTPS producer

The runtime hook SHALL accept the existing producer format with an additional
`transport: "private-https"` only for an HTTPS endpoint whose path is
`/api/monitor/v1/events`, without URL credentials, query or fragment. It SHALL
use that endpoint's origin with the existing SDK publication path. A remote
producer SHALL require a private installed version-1 receipt whose token,
directory, endpoint, qualification, lifecycle version, source configuration and
`input.transport` match. An absent transport SHALL retain the existing local
loopback rule and optional-receipt compatibility. A URL change alone SHALL NOT
inherit local qualification. All existing file, size, permission, normalizer,
metadata-only wrapper, trace, no-retry and 2.9-second fail-open rules SHALL remain.

#### Scenario: Explicit remote qualification
- **WHEN** a private enabled qualified HTTPS producer selects `private-https` with its matching installed receipt
- **THEN** its one observation is published through verified HTTPS as its granted source

#### Scenario: Missing or changed remote receipt
- **WHEN** the remote receipt is absent, applying, unsafe, or names a different transport, token, directory, endpoint, lifecycle version or source
- **THEN** the hook sends nothing and remains silent and fail open

#### Scenario: Old local qualification
- **WHEN** an existing local producer has no transport member, with or without its matching receipt, or its URL alone is changed to HTTPS
- **THEN** the local producer still works and the URL-only change emits nothing

#### Scenario: Host loss or half-open route
- **WHEN** credentials are missing or revoked, DNS/TLS is unavailable, a host sleeps, or an HTTPS peer takes a publication without answering
- **THEN** the hook ends within its existing budget, queues and retries nothing, and missing observations establish neither connectivity nor completion

### Requirement: Native producer setup and endpoint switching

The setup procedure SHALL identify the actual execution host and supported
Codex or Claude client path, reuse stable provider/client/host/source identity
and grant each selected producer only its own ingest source. It SHALL document
native startup/sign-in, private credential provisioning, receipt qualification,
manual pause/revocation and explicit endpoint switching separately from the core
container lifecycle. It SHALL preserve notify and unrelated settings and hooks.
Actual client qualification SHALL remain separate from source and disposable
TLS tests. An iPhone-driven session SHALL use its actual supported execution
host; a phone UI SHALL NOT establish local hook coverage for cloud-only work.

#### Scenario: Four selected feeds
- **WHEN** normalizer-produced Codex and Claude observations on two hosts use the same session identifier
- **THEN** four independent records retain their own activity, attention and notices, while duplicates or rejected observations add no owner or mixed state

#### Scenario: Endpoint switch
- **WHEN** the operator selects a new qualified core endpoint
- **THEN** the producer stays disabled until its endpoint, private grant and matching installed receipt are verified, with no queue, fallback credential or automatic replay
