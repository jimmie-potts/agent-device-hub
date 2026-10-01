## ADDED Requirements

### Requirement: Pixoo catalog and exact representation reads

The Hub SHALL forward typed read-only Pixoo catalog, playlist, manifest and indexed PNG routes to the registered controller using its private token. It SHALL require read scope and the controller alias grant, validate inputs and responses, preserve representation-specific strong ETags and conditional 304 semantics, and share the existing per-device request slot. It MUST NOT reserve command tickets or change the command ledger. Catalog pages SHALL use a limit of 1 to 100, default 25. Negotiated integration snapshot 1.1 SHALL coexist with legacy snapshot and command 1.0.

#### Scenario: Authorized exact preview
- **WHEN** an authorized reader requests a known rendition's manifest and frame
- **THEN** the Hub returns validated timing and PNG bytes with the owner's cache metadata and never exposes the controller token

#### Scenario: Legacy or invalid producer
- **WHEN** the producer supports only 1.0 or returns malformed catalog data
- **THEN** legacy controls continue to work and catalog support is unavailable or the malformed response is rejected

#### Scenario: Conditional access remains checked
- **WHEN** a conditional frame request has a matching ETag but the reader lacks permission or the rendition has been removed
- **THEN** authorization or membership failure is returned instead of 304
