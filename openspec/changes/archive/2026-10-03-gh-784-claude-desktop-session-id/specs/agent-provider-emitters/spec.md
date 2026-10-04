## ADDED Requirements

### Requirement: Claude Desktop host session enrichment
When a producer selects lifecycle 1.2, the Claude provider SHALL read `CLAUDE_CODE_HOST_SESSION_ID` from the hook process environment only when `CLAUDE_CODE_ENTRYPOINT` is exactly `claude-desktop`. It SHALL add the value as `hostSessionId` to root events only after identifier validation. No other environment value SHALL enter the envelope. A missing, different, malformed, oversized or unreadable value SHALL be omitted while the normalized event is still delivered within the existing deadline and size bounds. Envelope trimming SHALL drop title and project before the host session identifier. Claude CLI, Codex, child events and producers selecting 1.0 or 1.1 SHALL NOT carry the field.

#### Scenario: Desktop hook
- **WHEN** a lifecycle 1.2 Claude hook runs with the Desktop entrypoint and a valid `local_<uuid>`
- **THEN** the delivered event carries exactly that `hostSessionId` and no other environment value

#### Scenario: CLI or unusable environment
- **WHEN** the entrypoint is absent or not `claude-desktop`, or the value is missing, malformed or longer than 128 characters
- **THEN** the hook delivers the event without `hostSessionId`, silently and with success
