## ADDED Requirements

### Requirement: Approved Wemo power confirmation

Conversation SHALL use the configured plug and exact on or off setting in the approval. It SHALL follow the tracked operation and report a fresh power reading in the original reply or once as a later update to that reply.

#### Scenario: Readback arrives after the original reply

- **WHEN** the owner sees a pending reply and the approved plug reports its power later
- **THEN** the original exchange receives one update, including after reconnect or restart
- **AND** no write or turn-end notice is repeated

#### Scenario: The write is uncertain

- **WHEN** the plug's write reply was lost
- **THEN** Conversation describes the uncertainty and hold and does not confirm the requested power from a later ordinary poll
