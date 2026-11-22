## ADDED Requirements

### Requirement: Closing reply when a turn fails

An admitted turn that settles failed or uncertain SHALL save a single private closing reply explaining the known outcomes of its approved actions and the supported reason the turn stopped. The runtime SHALL use the records of that turn, preserve a provider's existing closing answer, and issue no model call, device command or retry to produce or deliver the fallback. If the cause is unknown, the fallback SHALL say so. Pending questions and paused tasks SHALL retain their controls.

#### Scenario: A failed command follows a successful step

- **WHEN** a turn has saved action evidence and a later approved action is refused, then the model cannot finish the turn
- **THEN** the closing reply describes both outcomes using the strongest recorded evidence, preserves confirmed phases across later reads with missing records, and remains readable after reload

#### Scenario: Recovery finds an uncertain call

- **WHEN** recovery settles a turn with an unresolved receipt and later receives evidence
- **THEN** the saved reply identifies uncertainty, recovery and late evidence produce no second answer or device write, and explicit continuation follows the existing recovery rules

#### Scenario: No diagnosis or proposal

- **WHEN** a read-only task or an answered clarification ends before a proposal or final explanation
- **THEN** the owner sees where the turn stopped, including a specific known limit when available, and the fallback makes no claim about the requested diagnosis
