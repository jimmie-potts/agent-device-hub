## ADDED Requirements

### Requirement: Preview an owner attachment in Conversation

Conversation SHALL accept one supported still or GIF from either a drop on the message field or the keyboard-operated Attach control. It SHALL show the same artwork to preview, replace or remove before the owner confirms a save or display.

#### Scenario: Select, replace or remove an attachment

- **WHEN** the owner selects or drops an image, replaces it, or removes it
- **THEN** Conversation shows the selected media or a visible validation error and issues zero display commands

#### Scenario: Save and display a single upload

- **WHEN** the owner confirms both actions
- **THEN** Conversation reports the library outcome and each selected display outcome independently
- **AND** a definitive failure can be retried without repeating a successful action, while an uncertain outcome stays visible without replay
