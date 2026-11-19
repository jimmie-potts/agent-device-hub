## MODIFIED Requirements

### Requirement: Inspectable observations and safe proof survival

The reviewer MUST directly exercise and assess relevant user-facing scenarios using shared asserted captures. A passed run MUST record exact source/artifact identity, completed assertions, valid finalized capture artifacts and no credential/content/path canaries in retained proof. Private synthetic state SHALL reside outside the candidate checkout and off temporary memory storage. The stopped container MUST survive until allowlisted proof is validated and copied to the canonical ignored proof root; wholesale runtime/config/log export is prohibited.

#### Scenario: Metadata-only connector journey
- **WHEN** synthetic selected Mac Codex root lifecycle, approval and subagent input is published
- **THEN** the reviewer observes session/turn activity, the approval until its turn's Stop, the child session under its root and the finished notice in the actual dashboard, with normal browser admission/recovery
- **AND** other child inputs, compaction and unselected inputs are refused, private content/transcript canaries remain excluded, and bad token/source, read/control/admin and Host/Origin checks preserve their refusals
- **AND** unavailable or stalled receivers leave the producer silent and fail-open within its existing budget, without retries

#### Scenario: Failed or abandoned capture
- **WHEN** an assertion fails, a browser crashes or a capture is abandoned
- **THEN** it cannot count as a satisfied independent verdict
- **AND** failed/partial evidence remains attributable while unsafe or unfinished artifacts cannot be represented as finalized proof
