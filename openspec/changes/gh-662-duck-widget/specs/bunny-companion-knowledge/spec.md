## ADDED Requirements

### Requirement: Explicit latest Duck conversation selection
The owner SHALL explicitly select or clear one permitted conversation containing Reachy and MicroDuck for the Home widget. The selection SHALL survive reload/restart, remain separate from message storage and creation order, and confer no sharing or output authority. New conversations and imported archives SHALL NOT silently select or replace it.

#### Scenario: Select one exchange without aggregating private history
- **WHEN** the owner selects one Reachy–Duck exchange while other conversations exist
- **THEN** the widget clearly labels that selection and reads only its permitted records
- **AND** a missing or unrelated private conversation is refused, a stale selection write does not overwrite the current choice, and clearing returns to an unselected state

### Requirement: Read one latest meaning and separate history
The Home widget SHALL show exactly one latest remaining Duck message by the selected conversation's creation order, with speaker, original time, meaning type, provenance and truthful available delivery evidence. A View conversation link SHALL open bounded history separately with speaker/time labels and navigation back to Home. Neither surface SHALL generate speech, capture, graph execution or device commands.

#### Scenario: Latest meaning follows authoritative corrections and removals
- **WHEN** a newer Duck message arrives, Reachy replies, an older message is corrected, or the latest Duck message is removed
- **THEN** the card uses the newest remaining Duck message without letting a Reachy reply or correction reorder it
- **AND** removal falls back to the previous message with its original time/evidence or explicit empty, including after restart

#### Scenario: Meaning and output evidence stay distinct
- **WHEN** the selected record is literal, emotional-only, unknown, synthetic, or has unqualified delivery references
- **THEN** the card labels the distinction without inventing translation or claiming audio played or was heard
- **AND** history remains readable without Reachy hardware, voice or a running model

#### Scenario: Private content is retired on invalidation or access loss
- **WHEN** selection or records change, a read fails or is denied, the connection is lost, or an older read finishes late
- **THEN** outdated content is hidden until a current permitted read succeeds, with unselected, empty, unavailable and stale states distinguishable
- **AND** no private content enters URLs, diagnostics or shared metadata and reconnect never replays an effect

#### Scenario: Accessible Home and history
- **WHEN** the owner adds the card, opens history, pages through messages and returns Home using a keyboard or narrow viewport
- **THEN** the selection and messages remain readable, updates do not steal focus, and Home displays no inline transcript or reveal control
- **AND** history uses the owner's existing pagination and retention rules without a twenty-message cap or separate archive
