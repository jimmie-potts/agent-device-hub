## MODIFIED Requirements

### Requirement: Local Codex hook with version-selected titles
The local Mac Codex wrapper SHALL reuse the existing bounded SDK hook for root SessionStart except compact, UserPromptSubmit, PermissionRequest, Stop, Interrupt and SessionEnd, and for SubagentStart and SubagentStop. For a root event it SHALL discard any input with an own agent_id property and forward only hook_event_name, session_id and optional turn_id; UserPromptSubmit, PermissionRequest, Stop and Interrupt SHALL require a valid turn_id. For SubagentStart and SubagentStop it SHALL require a valid own agent_id that differs from session_id, and SHALL forward only hook_event_name, session_id as the parent selector and agent_id, never turn_id. It SHALL discard whole any other input with an own agent_id property, including a child's PermissionRequest. It SHALL never open supplied paths, retain or publish raw private fields, change notify, decide permissions or command devices. A producer without lifecycleVersion SHALL publish without title lookup. A producer explicitly selecting lifecycleVersion 1.1 or 1.2 SHALL reuse the existing bounded title reader over session_index.jsonl in the hook process's Codex home for root events, preserving title validation, truncation and lookup limits. No supplied cwd, transcript, prompt, response, tool input or agent type SHALL reach enrichment. Producer and receipt validation SHALL precede input consumption. Delivery SHALL remain silent and fail open under the existing deadline without retries.

#### Scenario: Private or child input
- **WHEN** a hook includes prompt, reply, tool name or input, cwd, transcript path, agent type, agent transcript path or agent_id
- **THEN** private fields are discarded without path reads, and a child input other than SubagentStart or SubagentStop produces no observation, never one attributed to the parent

#### Scenario: A Codex approval
- **WHEN** a root PermissionRequest with a valid turn_id is followed by that turn's Stop, or by an Interrupt and then a newer turn's prompt or a SessionEnd
- **THEN** the core holds one approval without a request ID on that turn until the Stop, the newer turn or the runtime end removes it; no correlation is inferred, and a PermissionRequest without a valid turn_id sends nothing

#### Scenario: A Codex subagent
- **WHEN** SubagentStart and SubagentStop carry a valid agent_id under a parent session_id, including a parent the core has not seen, or carry no usable agent_id or session_id
- **THEN** the child is its own session with the known parent selector, an unknown turn and no title, the parent stops counting it as working at its stop, the parent keeps its own turn, and an unusable payload sends nothing

#### Scenario: Version-selected title and rename
- **WHEN** a qualified producer selects lifecycleVersion 1.1 or 1.2 and its local title index contains the session's title
- **THEN** a selected hook publishes the bounded validated title with its existing local identity and lifecycle observation; a later hook carries a changed index title without project or transcript fields

#### Scenario: Title unavailable or not selected
- **WHEN** the producer omits lifecycleVersion, or a selected lookup has no usable matching title
- **THEN** activity still publishes without a title, allowing the display's existing neutral fallback; no missing title invents activity or read evidence

#### Scenario: Installed local coverage
- **WHEN** the approved local Desktop and native CLI each run a controlled ordinary session
- **THEN** observed events reach the dashboard under the shared local identity, with supported gaps stated explicitly and existing notify preserved

#### Scenario: Cloud orchestration or unavailable hub
- **WHEN** orchestration cannot emit local hooks or the hub is unavailable
- **THEN** no coverage is claimed for that path and the hook returns silently without blocking agent work
