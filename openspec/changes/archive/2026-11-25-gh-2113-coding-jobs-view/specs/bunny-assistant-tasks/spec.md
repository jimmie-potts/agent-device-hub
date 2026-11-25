## ADDED Requirements

### Requirement: Separate explicit job instructions from ordinary Conversation

Conversation SHALL give each authorized coding-job receipt an attempt-specific card. An explicit natural-language job instruction SHALL be resolved to an eligible job and its current attempt. When the owner has not identified a unique target the page SHALL request a choice before sending. Ordinary messages and approvals SHALL retain their existing Conversation behavior while the job runs.

#### Scenario: Two similar jobs and a Hub question

- **GIVEN** two jobs for the same companion use the same repository
- **WHEN** the owner addresses one by a unique name and asks a separate Hub question
- **THEN** only the named attempt receives the job instruction and the Hub question proceeds in Conversation
