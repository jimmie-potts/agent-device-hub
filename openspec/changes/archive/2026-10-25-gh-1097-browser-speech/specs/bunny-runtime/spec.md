## ADDED Requirements

### Requirement: Tracked browser speech boundary
The runtime SHALL authorize the selected browser speech endpoint narrowly and invalidate its reservation on connection loss. Companion speech effects SHALL use the existing core tracked dispatcher and the companions module's durable outcome owner. Commands, receipts, errors, expiry and traces SHALL use profile 2.0 and ADR 0012. Ordinary browser action routes SHALL refuse internal speech dispatch and endpoint transport commands. Playback status SHALL remain distinct from succeeded, failed or uncertain command outcomes.

#### Scenario: Unprivileged speech attempt
- **WHEN** a read-only client or ordinary action route attempts to impersonate an endpoint or issue an internal speech command
- **THEN** the runtime refuses the request before any speech effect

#### Scenario: Lost output receipt
- **WHEN** a speech command was handed to the endpoint but no definitive receipt arrives before its deadline
- **THEN** the tracked operation becomes uncertain and neither the core nor the module retries playback

#### Scenario: Durable receipt and restart
- **WHEN** the companions owner commits a speech outcome but publication is interrupted
- **THEN** its existing outbox can republish the outcome after restart without resending the command or restoring browser availability
