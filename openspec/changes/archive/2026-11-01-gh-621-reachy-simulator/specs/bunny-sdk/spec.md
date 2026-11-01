## ADDED Requirements

### Requirement: Separately tracked priority frontend controls
The shared frontend Command contribution SHALL accept an optional module-qualified attemptKey for an independently retained priority control. Its target SHALL remain the actual command target. Ordinary controls SHALL share the existing target lock by default. A priority control SHALL preserve request identity, core tracking and no replay on reload.

#### Scenario: Cancel while an ordinary command is pending
- **WHEN** a module declares a separately keyed task-cancellation control and its ordinary gesture is pending or has no confirmed HTTP reply
- **THEN** the cancellation control can submit its own tracked request without replacing or resending the gesture request

#### Scenario: Reopening with an unanswered priority request
- **WHEN** the page reloads with an unanswered priority request
- **THEN** that request identity is retained without automatic resend and the ordinary command's retained identity remains separate
