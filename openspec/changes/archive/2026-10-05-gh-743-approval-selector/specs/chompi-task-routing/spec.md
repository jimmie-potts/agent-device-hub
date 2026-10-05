## MODIFIED Requirements

### Requirement: Explicit single Send
Send SHALL type exactly one Enter to a verified target after re-checking foreground, selection and composer focus, and only while the feed is current, the Hub shows no `approval` attention for the task and the adapter reports approval visibility as known `false`. Hub `approval` attention, a stale or unavailable feed, and approval visibility that is `true` or unknown SHALL each refuse Send; `question` and `input` attention SHALL NOT block it. Send SHALL be refused while Record is held, while another Send runs and within the repeat window after a Send. An uncertain keystroke MUST NOT be retried and SHALL clear the target. Small-knob clicks, the volume click, encoder turns, slot keys, Record and Back MUST NOT send, and the profile MUST NOT be able to map them to Send.

#### Scenario: Repeated wheel click
- **WHEN** the big-wheel click arrives twice within the repeat window
- **THEN** one Enter is typed

#### Scenario: Pending approval
- **WHEN** the Hub shows an approval for the target or the adapter reports an approval card
- **THEN** Send is refused

#### Scenario: Approval visibility not qualified
- **WHEN** the adapter answers approval visibility as unknown, as the Windows adapter does when Codex shows no composer or the client is not in front
- **THEN** Send is refused and no Enter is typed

#### Scenario: Task switch before Send
- **WHEN** another slot key is pressed after Record and before Send
- **THEN** the earlier target is cleared and Send is refused until the new task verifies
