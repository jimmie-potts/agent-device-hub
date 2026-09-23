## ADDED Requirements

### Requirement: Authorized monitor approval recovery
The host SHALL expose explicit approval recovery only to a control credential. It SHALL validate the full session identity, known turn and expected owner revision, retain command request replay behavior and return a fixed failure when the owner rejects recovery. It SHALL NOT contact a device or provider permission service.

#### Scenario: Guarded control request
- **WHEN** a control client submits recovery for an uncertain approval using a current revision and request ID
- **THEN** the host returns the owner result, and a repeated identical ticket returns the same result without a second mutation

#### Scenario: Unauthorized or stale request
- **WHEN** a client lacks control scope or the owner revision has changed
- **THEN** recovery does not mutate owner state
