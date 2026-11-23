## ADDED Requirements

### Requirement: Device readback for a tracked request

A device owner SHALL publish a request-linked setting reading in the existing versioned device state family. The result SHALL identify the request and the setting and preserve the evidence time. A bounded recent result SHALL remain available through SDK sync and owner restart.

#### Scenario: A later snapshot contains a completed read

- **WHEN** an authorized consumer syncs after the reading and within its retention bounds
- **THEN** the owner can supply the original request's result even if its current setting has since changed
- **AND** the tracked command still has one terminal outcome
