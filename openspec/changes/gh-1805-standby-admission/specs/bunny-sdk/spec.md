## ADDED Requirements

### Requirement: Standby SDK refusal

The standby gateway's remote edge SHALL retain authentication, declared source,
method and bounded body decoding checks. After a successful body read it SHALL
recheck the original admission before inspecting operation fields. A valid
stream or call SHALL receive the shared `unavailable` refusal with fixed detail
before ordinary call permissions or endpoint authority can admit it. No standby
call SHALL reach the bus, register a participant, touch command memory or
open, use or close an endpoint. Ordinary edge grants SHALL keep their behavior.

#### Scenario: SDK calls cannot allocate or dispatch
- **WHEN** an admitted standby reader opens a stream, sends a command, publishes a fact or uses an endpoint
- **THEN** the edge refuses before effects, preserving existing pure structural errors for malformed requests
