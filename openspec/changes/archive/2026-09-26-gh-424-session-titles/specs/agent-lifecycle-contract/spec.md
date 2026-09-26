## ADDED Requirements

### Requirement: Versioned session display metadata
The contract SHALL accept lifecycle 1.1 title values with provider or user source, separate project display names and labels with user or agent origin. Titles SHALL be limited to 160 Unicode scalars and project names and labels to 80, nonempty and control-free. Credentials and tokens SHALL remain excluded. Lifecycle 1.0 SHALL retain its strict shape.

#### Scenario: Shared title and prompt-related words
- **WHEN** a 1.1 event contains a title about editing prompts and a project display name
- **THEN** both language validators accept it, while rejecting extra credential, prompt, response or transcript-content fields

#### Scenario: Legacy shape
- **WHEN** a 1.0 envelope contains a 1.1 field
- **THEN** both validators reject it with a content-free error

## MODIFIED Requirements

### Requirement: Strict versioned metadata

The contract SHALL validate a bounded versioned envelope containing provider/client, neutral host/source/session identity, available turn identity, event identity or deterministic fallback, event kind and observation time. Unknown fields, incompatible versions, undeclared payload fields and malformed values SHALL be rejected with content-free errors.

#### Scenario: Privacy canary
- **WHEN** an otherwise valid event contains an undeclared credential, token, prompt, transcript, response or full-path field
- **THEN** no validated event or content-bearing error is returned

#### Scenario: Unsupported version and excessive input
- **WHEN** the wire version is unsupported or input exceeds size/depth bounds
- **THEN** both language consumers reject it without exposing input content
