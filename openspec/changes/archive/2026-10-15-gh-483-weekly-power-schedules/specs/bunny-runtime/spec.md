## MODIFIED Requirements

### Requirement: Automation controls

The dashboard SHALL provide one Automation page for event rules, weekly power schedules, interrupt set, budgets, quiet hours and logs through the authenticated gateway. Read calls SHALL require read scope; mutations SHALL require control scope and bunny-request:1. Rules created without explicit owner enabling SHALL remain disabled. Weekly power schedules SHALL use the Hub-owned scheduling path and operating limits in bunny-power-schedules; event rules SHALL retain their existing behavior. No model call, device-specific browser scheduler or personal-content publication SHALL be introduced.

#### Scenario: Owner creates a rule
- **WHEN** the owner creates and enables a valid event rule through the authenticated page
- **THEN** its targets and shape are checked before storage and the core can evaluate it independently of the page

#### Scenario: A pending write loses authority
- **WHEN** an Automation mutation lacks control scope or bunny-request:1, or its original credential is revoked or rotated while its body is being read
- **THEN** the gateway returns the shared refusal code without changing rules or settings, records the refusal without request data, and leaves the core running

#### Scenario: Rule and log controls
- **WHEN** the owner reads or edits rules, the interrupt set or settings and inspects the Automation log
- **THEN** bounded authenticated routes preserve the existing shapes under automation/2.0, rules remain disabled unless explicitly enabled, and log entries identify admission separately from any tracked terminal outcome
