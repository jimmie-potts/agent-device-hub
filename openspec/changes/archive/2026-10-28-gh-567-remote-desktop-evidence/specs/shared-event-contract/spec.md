## ADDED Requirements

### Requirement: Desktop metadata family

The contract SHALL register the `desktop-metadata` occurrence family (Hub #567): type `org.bunny.desktop-metadata.observed`, dataschema `https://bunny.invalid/events/desktop-metadata/2.0`, on `bunny.event.desktop-metadata.<feed ID>`, where the feed ID is the lowercase hex SHA-256 of the feed's sorted `client`, `hostId`, `provider` and `sourceId` in UTF-8 JSON and the envelope's subject SHALL be that ID. Its payload SHALL be exactly `feed` (`provider: codex`, `client: desktop`, `hostId`, `sourceId`), `observedAtMs`, `stamp` (1 to 64 letters, digits, dots, colons, underscores or hyphens), `unread` (at most 4096 distinct IDs, or null), `archived` (at most 2048 distinct IDs, or null) and `titles` (at most 512 entries with distinct IDs, each a provider title). TypeScript and Python SHALL process the same fixtures with identical outcomes, and the core SHALL take no session change from the family.

#### Scenario: Valid and invalid snapshots
- **WHEN** a snapshot has the feed's subject, bounded distinct sets and provider titles, and others have a wrong subject, a `local` client, 4097 unread IDs, a duplicate archive ID, a user title, an extra member or no stamp
- **THEN** both validators accept the first and reject each of the others with a fixed safe error
