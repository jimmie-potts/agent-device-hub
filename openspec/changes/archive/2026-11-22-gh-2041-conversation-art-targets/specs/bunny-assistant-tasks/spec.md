## ADDED Requirements

### Requirement: Resolve exact artwork and display before Conversation approval

Conversation SHALL resolve the requested artwork and configured display identities before offering a display action. It SHALL distinguish a browser composition from the browser destination and a device kind from its routing ID. Each proposed destination SHALL be eligible for the exact artwork and visibly identified. Conversation SHALL explain unavailable choices and require a specific choice among ambiguous matches.

#### Scenario: A display kind matches more than one installation target

- **WHEN** the owner asks for a display by kind and two configured displays could match
- **THEN** Conversation asks which display to use and dispatches nothing before an exact selection and approval

#### Scenario: Generate for the reply and show on a display

- **WHEN** the owner approves generation for a request that also names a configured display, and the exact generated attachment becomes ready
- **THEN** the reply presents that attachment and offers a separate display approval with the intended destination selected, even if another artwork has been created since

#### Scenario: Select a destination for a ready attachment

- **WHEN** the owner opens Show on for a saved attachment
- **THEN** available choices refer to that same artwork, incompatible or unavailable choices identify the reason, and a confirmed show reports preparation and presentation evidence for each chosen destination

#### Scenario: A proposed show is dismissed or interrupted

- **WHEN** the owner declines the proposal, reloads the page or reconnects after an uncertain dispatch
- **THEN** Conversation performs no automatic generation or display write and restores the tracked preparation and presentation evidence for each selected destination, including uncertainty after a lost reply
