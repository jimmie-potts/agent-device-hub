## Context

See the proposal for the outcome. The core already accepts profile 2.0 lifecycle
observations, identifies sessions by provider/client/host/source/session, and
deduplicates delivery. The accepted private ingress authenticates ordinary
scoped credentials. Hook files retain their released local format.

## Decisions

An optional `transport: "private-https"` in the existing private producer selects
an HTTPS endpoint with the existing `/api/monitor/v1/events` suffix. Only its
origin is used for the existing SDK publication route. A remote producer requires
a private installed version-1 receipt whose input also selects the same
transport. Replacing a local endpoint alone cannot activate remote publication.
The old absent-transport loopback rule and optional receipt remain unchanged.
An endpoint switch is a new qualification, with a disabled producer while its
receipt is being prepared. This avoids a second hook/forwarder protocol.

The publisher chooses Node's HTTP or HTTPS request implementation and explicitly
requires certificate verification for HTTPS. It carries no client-configurable
TLS bypass. The total budget covers DNS, TCP, TLS and the answer. HTTPS becomes
reachable only after its authenticated TLS connection completes; certificate or
handshake failures before then are unpublished `unavailable`. A lost answer
after that remains `uncertain-result`. Redirects are answers, never another
destination; there is no downgrade or automatic retry.

The runtime validates the helper-derived producer source against the observation's
provider/client/host/source tuple. Session IDs remain outside the credential
identity so different sessions can share their selected feed. The check follows
schema validation and precedes bus publication. Ordinary module sources retain
their contracts. A changed configured identity needs its own grant, never another
host's token. This closes payload impersonation as well as header impersonation.

ADR 0012's error/effect rules and diagnostic contract remain authoritative.
Hooks stay silent, bounded and fail open. Existing edge refusal records retain
the message trace and registry code. No exception text, credential, raw provider
input or address becomes a new diagnostic. Lost observations are not queued or
replayed, and missing evidence never establishes completion or connectivity.

## Risks and qualification

Remote DNS/TLS can consume the whole hook budget; subprocess tests exercise the
hard deadline and the publisher tests distinguish before-send from uncertain
effects. Synthetic TLS uses only a disposable test CA and cannot establish
Tailscale or OS trust. Four normalizer-produced provider/host feeds with the same
session ID must remain independent. Refused source/identity changes and revoked
tokens must leave the core unchanged. Existing local producer, browser and MCP
tests remain required.

## Installation and recovery

Use the accepted Mac container/operator and private ingress, preserving volumes,
state and the existing local producer. Keep the current local Mac Codex connector
unless its endpoint is explicitly selected for change. Qualify selected PC and
Mac client paths, credentials and supported hook configuration before enrollment.
Record actual execution location for the selected iPhone-driven session.
No source test qualifies those installed paths. Source installation follows
review, merge and merged-main CI; personal hook changes retain their separate
owner setup boundary.

To pause a connector, disable only its selected hook definitions or revoke its
ingest credential. Preserve notify, other hooks and latest core state. Inspect
uncertain setup writes before retrying. Never restore an old database to undo
connector enrollment, restart old device writers or activate another core.
