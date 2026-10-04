## ADDED Requirements

### Requirement: Versioned host session identifier
The contract SHALL accept lifecycle 1.2 envelopes, which are lifecycle 1.1 envelopes with one optional `hostSessionId` string using the neutral identifier grammar. The field names the hosting application's own session, such as a Claude Desktop `local_<uuid>`, and SHALL NOT be a session identity. It SHALL be rejected on an event whose parent is known. Lifecycle 1.0 and 1.1 SHALL keep their strict shapes and reject the field. Malformed, empty, oversized or non-string values and any undeclared environment field SHALL be rejected with content-free errors by both language validators.

#### Scenario: Desktop session identifier
- **WHEN** a 1.2 root Claude event carries `hostSessionId` `local_<uuid>`, with or without title, project and label metadata
- **THEN** both validators accept it and return the same deduplication key from the shared corpus

#### Scenario: Older versions and invalid values
- **WHEN** a 1.0 or 1.1 envelope, a child event or a malformed or 129-character value carries `hostSessionId`
- **THEN** both validators reject it without exposing input content
