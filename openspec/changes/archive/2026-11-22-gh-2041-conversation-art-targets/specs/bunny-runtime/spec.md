## ADDED Requirements

### Requirement: Inspect configured art destinations for approval

The art targets read SHALL offer an approval view that associates each configured display with its current identity and eligibility for a guarded action. The default read SHALL continue to provide the configured target inventory to existing Gallery clients.

#### Scenario: Inspect a configured display with insufficient evidence

- **WHEN** a client asks for approval choices and the current owner evidence cannot bind a configured display
- **THEN** the approval view does not supply a usable guard for that display and the client can explain why it cannot approve the show
