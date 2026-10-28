## ADDED Requirements

### Requirement: Producer identity admission

For a lifecycle observation through the configured private HTTPS ingress from a
helper-derived `bunny/parts/hub-<digest>` producer source, the runtime SHALL compare
that source with the existing
credential derivation from the observation's provider, client, hostId and
sourceId. A mismatch SHALL be refused with `forbidden` before bus publication.
The session identifier SHALL NOT participate in credential identity. Header and
envelope source binding, module-source contracts and ordinary scope checks
SHALL remain unchanged. Released loopback producers SHALL retain their complete
configuration-derived credential identity, including ignored extension members.
The private-entry check SHALL run after ordinary SDK validation and scope checks
and before bus publication. Refusal SHALL retain the existing edge diagnostic
code, authenticated source and route without credentials or private payloads.
Server refusal records SHALL NOT claim message-trace correlation; the publisher
SHALL retain its own prepared-message trace in its returned error. Accepted core
intake SHALL retain its existing message-trace correlation.

#### Scenario: Payload impersonation
- **WHEN** a private-ingress producer token names its own source but puts another host, provider, client or sourceId in its lifecycle identity
- **THEN** the gateway refuses with `forbidden` before the core sees the observation, and the same credential still publishes its own feed

#### Scenario: Four source identities
- **WHEN** two hosts each publish normalizer-produced Codex and Claude observations through the private HTTPS ingress with the same session identifier
- **THEN** all four records remain independent, exact duplicates change no state and a revoked token cannot update any feed

#### Scenario: Released local configuration extensions
- **WHEN** a granted local producer includes an ignored source configuration member accepted by the released normalizer and setup
- **THEN** its complete source-derived credential remains valid and its observation reaches the same core without inheriting private remote qualification

#### Scenario: Refusal correlation boundary
- **WHEN** private-entry identity admission refuses an authenticated publication
- **THEN** the server records forbidden with its authenticated source and publish route without claiming a message trace, the publisher error retains its prepared trace ID, and a subsequent accepted observation retains the core's normal trace
