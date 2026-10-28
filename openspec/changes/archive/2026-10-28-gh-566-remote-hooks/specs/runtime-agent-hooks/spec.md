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

## MODIFIED Requirements

### Requirement: Bounded, quiet and fail-open hooks

Every path of the hook SHALL write nothing to stdout or stderr and exit 0, except unfinished native filesystem or DNS work at the deadline, which `process.exit` would wait for: the hook SHALL then end itself by `SIGKILL`. The hook SHALL make no permission decision, retry, device call or child process. A deadline 2.9 s from the process's start SHALL be armed before anything loads and SHALL end the process, inside the clients' 3 s hook timeout, whatever the runtime does; the publication SHALL get what is left of it. A hook whose work is done SHALL exit once no native filesystem or DNS worker remains. A check that cannot tell whether one remains SHALL count as none, so the hook still exits 0. Input over 8 MiB, input that is not UTF-8 JSON, and a hook the normalizers do not map SHALL end the hook with nothing sent. A refused, revoked or unknown credential, a stopped runtime and a lost answer SHALL end it quietly too: the observation is lost, and nothing sends it again.

#### Scenario: A stopped runtime or a refused credential
- **WHEN** the hook runs against a port nothing listens on, or with a token the runtime does not hold
- **THEN** it exits 0 at once and writes nothing

#### Scenario: A runtime that never answers
- **WHEN** the hook runs against a listener that takes the call and never answers, or its client never closes stdin
- **THEN** it exits 0 on its own once its 2.9 s budget passes, within 3 s of its start, and writes nothing

#### Scenario: A file read stuck at the deadline
- **WHEN** a file read in the hook's process is stuck in an `open` that never returns, as a title read on a stalled mount is
- **THEN** the hook publishes its observation and ends by `SIGKILL` at its 2.9 s budget, within 3 s of its start, writing nothing; a FIFO as the transcript, which the title read opens without blocking, ends the hook at once with exit 0, and so does a process whose check for a pending read throws

#### Scenario: Input the normalizers do not map
- **WHEN** the hook gets no input, input that is not JSON or not an object, no hook name, a hook the normalizers do not map, no or a malformed session ID, input over 8 MiB or input that is not UTF-8
- **THEN** it exits 0, writes nothing and nothing reaches the core

#### Scenario: Native DNS remains blocked
- **WHEN** either hook entrypoint starts a native hostname lookup that cannot finish within the hook budget
- **THEN** its own hard deadline ends it silently by signal within the existing client timeout without waiting for the resolver; no HTTP observation has been sent, and an independent controller does not enforce the deadline
