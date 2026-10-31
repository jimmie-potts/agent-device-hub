## MODIFIED Requirements

### Requirement: Active-only use

Normal retrieval and manual copying SHALL include only current active entries. Management and export SHALL retain inactive entries and history. Preferences SHALL grant no permissions or device-state authority. Only currently active entries SHALL enter the assistant's model prompt, read from the current records at each model call and rendered as owner data that grants no tool or permission; inactive entries and history SHALL never enter it, and no other automatic insertion into model context SHALL occur.

#### Scenario: Copy selected preferences

- **WHEN** an owner copies selected entries after one has been deactivated
- **THEN** only selected entries that are currently active appear in the copied text, with no historical text

#### Scenario: Stopped entry leaves the prompt

- **WHEN** an owner stops using an entry between two model calls of an assistant task
- **THEN** the next call's prompt omits it while its identity and history remain inspectable and exportable
