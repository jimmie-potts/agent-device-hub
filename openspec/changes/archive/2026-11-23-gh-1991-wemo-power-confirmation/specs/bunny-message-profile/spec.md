## ADDED Requirements

### Requirement: Request-linked power evidence in device state

The Wemo owner SHALL bind an acknowledged power write and its subsequent read to the exact request, configuration and generation. The existing device state sync SHALL make bounded recent evidence available after reconnect.

#### Scenario: A newer plug state is published

- **WHEN** a newer read or write changes the plug's general observed state
- **THEN** it cannot substitute for the retained result of a different approved request
