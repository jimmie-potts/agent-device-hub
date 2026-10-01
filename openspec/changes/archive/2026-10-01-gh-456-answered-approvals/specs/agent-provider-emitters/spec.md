## MODIFIED Requirements

### Requirement: Qualified metadata mappings
Source adapters SHALL map documented Codex and Claude events using explicit source installation configuration. Child events MUST retain child and evidenced parent identities. Missing turn/order/correlation MUST remain unknown. Unsupported client paths MUST remain disabled until their separate installed qualification.

#### Scenario: Provider normalization
- **WHEN** a supported event supplies a valid session ID and optional qualified turn or child ID
- **THEN** the adapter creates the corresponding lifecycle observation, configured source identity and one observation timestamp; version-selected title/project enrichment allowlists its own fields without copying provider records

#### Scenario: Unknown coverage
- **WHEN** Claude interruption, unqualified continuing-input semantics or Desktop read/hook evidence is requested
- **THEN** the adapter does not invent that evidence or enable an unqualified installed path

#### Scenario: Claude tool completion
- **WHEN** a root Claude `PostToolUse` or `PostToolUseFailure` supplies `tool_use_id` and `prompt_id`
- **THEN** the adapter emits `attention.resolved` with that known ID on that turn; without either field, from a child agent or from Codex, it emits nothing
