## ADDED Requirements

### Requirement: Metadata-only local Codex hook
The local Mac Codex wrapper SHALL reuse the existing bounded SDK hook for SessionStart except compact, UserPromptSubmit, Stop, Interrupt and SessionEnd. It SHALL discard any input with an own agent_id property and forward only hook_event_name, session_id and optional turn_id. It SHALL never open supplied paths, enrich from local indexes, retain or publish raw private fields, change notify, decide permissions or command devices. A metadata-only producer check SHALL refuse lifecycle enrichment before consuming input. Delivery SHALL remain silent and fail open under the existing deadline without retries.

#### Scenario: Private or child input
- **WHEN** a hook includes prompt, reply, cwd, transcript path or agent_id
- **THEN** private fields are discarded without path reads, and a child input produces no parent observation

#### Scenario: Misconfigured enriched producer
- **WHEN** the wrapper selects a producer with lifecycleVersion configured
- **THEN** it refuses before reading hook input or attempting network/file enrichment

#### Scenario: Installed local coverage
- **WHEN** the approved local Desktop and native CLI each run a controlled ordinary session
- **THEN** observed events reach the dashboard under the shared local identity, with supported gaps stated explicitly and existing notify preserved

#### Scenario: Cloud orchestration or unavailable hub
- **WHEN** orchestration cannot emit local hooks or the hub is unavailable
- **THEN** no coverage is claimed for that path and the hook returns silently without blocking agent work
