## ADDED Requirements

### Requirement: Producer identity admission

For a lifecycle observation from a helper-derived `bunny/parts/hub-<digest>`
producer source, the runtime SHALL compare that source with the existing
credential derivation from the observation's provider, client, hostId and
sourceId. A mismatch SHALL be refused with `forbidden` before bus publication.
The session identifier SHALL NOT participate in credential identity. Header and
envelope source binding, module-source contracts and ordinary scope checks
SHALL remain unchanged. Refusal SHALL use the existing edge diagnostic and
message trace, without credentials or private payloads.

#### Scenario: Payload impersonation
- **WHEN** a valid producer token names its own source but puts another host, provider, client or sourceId in its lifecycle identity
- **THEN** the gateway refuses with `forbidden` before the core sees the observation, and the same credential still publishes its own feed

#### Scenario: Four source identities
- **WHEN** two hosts each publish normalizer-produced Codex and Claude observations through the private HTTPS ingress with the same session identifier
- **THEN** all four records remain independent, exact duplicates change no state and a revoked token cannot update any feed
