## ADDED Requirements

### Requirement: Assistant state supervisor choices

The package SHALL register `assistant-state/2.4` for a configured OpenAI supervisor. This version SHALL publish provider and model names for the available choices beside the existing default provider and model and MAY carry the pinned pair on current tasks. The state SHALL exclude credentials, prompt text, provider transcript items and worker state. The prior versions retain their schemas.

#### Scenario: Versioned state with two configured supervisors

- **WHEN** Anthropic and OpenAI supervisors are available
- **THEN** `assistant-state/2.4` carries both choices and the configured default while retaining the existing task and queue fields
