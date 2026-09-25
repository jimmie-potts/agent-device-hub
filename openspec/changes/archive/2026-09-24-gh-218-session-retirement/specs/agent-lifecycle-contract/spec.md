## ADDED Requirements

### Requirement: Desktop session-end interpretation
The existing lifecycle 1.0 `runtime.ended` envelope SHALL cover documented Codex Desktop SessionEnd causes without a new timer or cause detector. The owner SHALL retire known Desktop sessions and their known descendants; this SHALL NOT change other provider/client policies or imply success, cancellation, acknowledgment or readership.

#### Scenario: Normalized Desktop end
- **WHEN** the Codex Desktop normalizer receives SessionEnd
- **THEN** it emits runtime.ended for the same native identity, with unknown ordering when none is qualified, and owner retirement does not depend on the cause or archive availability
