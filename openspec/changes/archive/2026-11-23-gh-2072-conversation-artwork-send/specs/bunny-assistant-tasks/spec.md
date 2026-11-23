## MODIFIED Requirements

### Requirement: Preview an owner attachment in Conversation

Conversation SHALL accept one supported still or GIF from a drop on the message field or the keyboard-operated Attach control. It SHALL show the exact draft media and let the owner replace or remove it. Send SHALL accept a valid attachment with or without text, preserve it in the original exchange, and request its durable library save once.

#### Scenario: Select, replace or remove an attachment

- **WHEN** the owner selects, drops, replaces or removes an image before Send
- **THEN** Conversation shows the selected media or a visible validation error and issues zero library saves and zero display commands

#### Scenario: Send an attachment by itself

- **WHEN** the owner sends a valid attachment with empty or whitespace-only text
- **THEN** the original exchange shows the exact attachment and the library save result
- **AND** Conversation asks whether to display the saved artwork and issues zero display commands until the owner chooses a display
- **AND** reopening the conversation renders the same attachment

#### Scenario: Save and display a single upload

- **WHEN** the owner sends a valid attachment and an explicit request to play or show it on one uniquely resolved configured display
- **THEN** Conversation saves the attachment and uses Send as authority for one guarded request to present that attachment on that display
- **AND** the exchange reports the save and display results independently and offers no second confirmation

#### Scenario: The display instruction does not grant usable authority

- **WHEN** the text is quoted or conditional, the destination is missing or ambiguous, or the target has become ineligible
- **THEN** Conversation preserves the attachment save, explains the lack of an eligible destination or asks a focused question, and issues zero display commands

#### Scenario: A Send or display result may have been lost

- **WHEN** the client repeats Send, reconnects, or recovers the original exchange after a restart
- **THEN** Conversation preserves one sent message and one library item for that Send
- **AND** it reconciles display evidence in the original exchange without automatically repeating an uncertain command

### Requirement: Resolve exact artwork and display before Conversation approval

Conversation SHALL resolve the requested artwork and configured display identities before offering a display action or accepting an explicit display instruction at Send. It SHALL distinguish a browser composition from the browser destination and a device kind from its routing ID. Each proposed destination SHALL be eligible for the exact artwork and visibly identified. Conversation SHALL explain unavailable choices and require a specific choice among ambiguous matches.

#### Scenario: A display kind matches more than one installation target

- **WHEN** the owner asks for a display by kind and two configured displays could match
- **THEN** Conversation asks which display to use and dispatches nothing before the owner explicitly chooses the destination for that same artwork

#### Scenario: Generate for the reply and show on a display

- **WHEN** the owner approves generation for a request that also names a configured display, and the exact generated attachment becomes ready
- **THEN** the reply presents that attachment and offers a separate display approval with the intended destination selected, even if another artwork has been created since

#### Scenario: Select a destination for a ready attachment

- **WHEN** the owner opens Show on for a saved attachment
- **THEN** available choices refer to that same artwork, incompatible or unavailable choices identify the reason, and a confirmed show reports preparation and presentation evidence for each chosen destination

#### Scenario: A proposed show is dismissed or interrupted

- **WHEN** the owner declines the proposal, reloads the page or reconnects after an uncertain dispatch
- **THEN** Conversation performs no automatic generation or display write and restores the tracked preparation and presentation evidence for each selected destination, including uncertainty after a lost reply
