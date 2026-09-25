## REMOVED Requirements

### Requirement: Desktop session-end interpretation
**Reason**: The Desktop-only interpretation is superseded by one session-end rule for every supported path.
**Migration**: The `runtime.ended` envelope is unchanged; owners retire the known tree on every path and the Desktop scenario is covered by the path-parameterized scenario below.

## ADDED Requirements

### Requirement: Session-end interpretation
The existing lifecycle 1.0 `runtime.ended` envelope SHALL cover the documented SessionEnd causes of Codex Desktop, Codex CLI and Claude Code without a new timer, cause detector or wire field; a provider's end reason and start source MUST NOT enter the envelope. The owner SHALL retire the known session and its known descendants on every supported path; this SHALL NOT imply success, cancellation, acknowledgment or readership. Missing or unqualified end evidence is a coverage gap, never an invented end.

#### Scenario: Normalized end on every supported path
- **WHEN** a Codex Desktop, Codex CLI or Claude Code normalizer receives SessionEnd with any documented reason
- **THEN** it emits runtime.ended for the same native identity without the reason, with unknown ordering when none is qualified, and owner retirement does not depend on the cause, path or archive availability

#### Scenario: Clear, resume and compact
- **WHEN** a provider ends a session with reason clear or resume, or starts one with source resume, clear or compact
- **THEN** the end retires the ended identity, a start is an ordinary start for its identity, and a same-identity start after retirement creates a fresh record subject to the retained delayed-event guards
