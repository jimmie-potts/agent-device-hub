## ADDED Requirements

### Requirement: Profile 1.10 Nanoleaf HTTP timing

Profile 1.10 SHALL register bounded Nanoleaf HTTP read timing records under the runtime Nanoleaf module. The records SHALL carry neutral device identity, closed read source and completion branch, elapsed time, deadline and sample count. They SHALL support separate observed and pending callback delay and a bounded count for repeated failures. They SHALL exclude addresses, tokens, endpoints, payloads, audio and free-form text. Previous profiles SHALL reject the added events and attributes. Profile 1.10 SHALL continue to admit the profile 1.9 history warning. The default producer profile SHALL remain 1.1.

#### Scenario: Closed profiles
- **WHEN** a synthetic timing record is validated at 1.10 and earlier profiles
- **THEN** only 1.10 admits it, an invalid timing field is refused, and a valid profile 1.9 history warning remains valid at 1.10
