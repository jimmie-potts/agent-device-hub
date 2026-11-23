## ADDED Requirements

### Requirement: Approved device confirmation in Conversation

Conversation SHALL associate the approved Pixoo brightness request with its original task, turn, owner and target. It SHALL report the strongest correlated evidence available at turn end and recover a pending confirmation through SDK sync without reissuing the write.

#### Scenario: The display reports before the deadline

- **WHEN** the approved display reports fresh brightness for the tracked request within the turn's observation window
- **THEN** the original reply states the percentage the display reported, including a different or already-matching value
- **AND** answering approval clears its attention item and the turn ends once

#### Scenario: The display reports after the turn ends

- **WHEN** the original reply says confirmation is pending and correlated evidence becomes available later
- **THEN** one update appears on the original exchange, including after restart or duplicate delivery
- **AND** the original reply and its notice remain intact

#### Scenario: No reading can confirm the request

- **WHEN** readback is unavailable or only an unrelated reading exists
- **THEN** Conversation preserves any acknowledgment and reports the remaining uncertainty or lack of confirmation
