## ADDED Requirements

### Requirement: Profile 1.8 registers the art provider call
Profile 1.8 SHALL add one span name, `bunny.art.call`, which earlier profiles do not register. It SHALL add no event or attribute, and prompts, responses and keys SHALL stay out of the span.

#### Scenario: A host selects an earlier profile
- **WHEN** a host on profile 1.7 or earlier meets a `bunny.art.call` span
- **THEN** it does not record the span

#### Scenario: The runtime records a provider call
- **WHEN** the art module calls a provider on the runtime's profile 1.8
- **THEN** one `bunny.art.call` client span carries `bunny.operation` and `bunny.request.id`
