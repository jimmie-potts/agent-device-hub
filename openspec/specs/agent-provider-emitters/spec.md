# agent-provider-emitters Specification

## Purpose

Normalize documented provider observations into private lifecycle metadata and deliver them with finite resource use while preserving agent execution.

## Requirements

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

### Requirement: Silent bounded fail-open delivery
Emitters SHALL have finite input, output, queue and lifetime bounds derived from the frozen early #30 budget. Failure MUST leave agent permissions unchanged, emit no stdout/stderr/context/wakeup output, avoid retries and device commands, and terminate within the 3,000 ms hard deadline. Disabled emitters MUST perform no delivery.

#### Scenario: Collector outage and saturation
- **WHEN** delivery stalls, rejects, times out or the producer reaches capacity
- **THEN** the emitter returns successfully within its bound, retains only a bounded content-free loss indicator and does not grow an unbounded queue

#### Scenario: Privacy before transport
- **WHEN** raw input contains private canaries beside valid lifecycle identifiers
- **THEN** only explicitly selected metadata is serialized, with no private input in transport, diagnostics, persistence or errors

#### Scenario: Device and UI independence
- **WHEN** the browser is closed or a device is unavailable or in Media/Free mode
- **THEN** observation delivery has no device/UI dependency and issues no device command

### Requirement: Bounded title and project enrichment
Producers SHALL optionally read bounded Codex session-index or Claude title records and report project basenames. Claude custom-title SHALL precede ai-title. Missing or invalid metadata SHALL NOT suppress lifecycle delivery or extend the existing hook deadline, event, queue or process bounds. Parent metadata SHALL NOT be assigned to child events.

#### Scenario: Rename on a later event
- **WHEN** a supported provider title changes before a later hook
- **THEN** the later event carries the new title from the bounded source

#### Scenario: Unreadable source
- **WHEN** a source is missing, unreadable, malformed, too large or times out
- **THEN** the hook remains silent and fail-open and attempts lifecycle reporting without that metadata

### Requirement: Claude Desktop host session enrichment
When a producer selects lifecycle 1.2, the Claude provider SHALL read `CLAUDE_CODE_HOST_SESSION_ID` from the hook process environment only when `CLAUDE_CODE_ENTRYPOINT` is exactly `claude-desktop`. It SHALL add the value as `hostSessionId` to root events only after identifier validation. No other environment value SHALL enter the envelope. A missing, different, malformed, oversized or unreadable value SHALL be omitted while the normalized event is still delivered within the existing deadline and size bounds. Envelope trimming SHALL drop title and project before the host session identifier. Claude CLI, Codex, child events and producers selecting 1.0 or 1.1 SHALL NOT carry the field.

#### Scenario: Desktop hook
- **WHEN** a lifecycle 1.2 Claude hook runs with the Desktop entrypoint and a valid `local_<uuid>`
- **THEN** the delivered event carries exactly that `hostSessionId` and no other environment value

#### Scenario: CLI or unusable environment
- **WHEN** the entrypoint is absent or not `claude-desktop`, or the value is missing, malformed or longer than 128 characters
- **THEN** the hook delivers the event without `hostSessionId`, silently and with success
