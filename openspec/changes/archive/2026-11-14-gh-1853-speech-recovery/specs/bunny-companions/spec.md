## ADDED Requirements

### Requirement: Explicit recovery of orphaned speech
After restart, an authorized operator SHALL be able to release an orphaned uncertain speech reservation by naming the current operation and revision and confirming that playback in earlier voice tabs is stopped or those tabs are closed. The UI SHALL also cancel local synthesis and refuse recovery while local output remains active. Recovery SHALL preserve the original uncertain playback and tracked outcome, retain consumed candidate identities and require a separate fresh enable action. It SHALL NOT replay an utterance, claim completion or automatically release a later uncertain operation.

#### Scenario: Recover after restart
- **WHEN** uncertain speech survives restart and the operator explicitly recovers the advertised orphan after stopping earlier playback
- **THEN** the acknowledgement survives another restart, speech remains off until enabled, and a new eligible reply can speak without replaying the old candidate

#### Scenario: Unsafe or stale recovery
- **WHEN** a recovery names stale state, lacks confirmation, lacks control authority, or an endpoint or live attempt is still reserved
- **THEN** it is refused without releasing a reservation or producing speech

#### Scenario: Recovery cannot be saved
- **WHEN** the acknowledgement or state revision cannot commit
- **THEN** recovery is refused with the shared storage error code and the old reservation remains blocked

#### Scenario: Browser recovery loses its connection
- **WHEN** the browser disconnects, navigates away or receives an ambiguous reply during recovery
- **THEN** it submits no automatic retry and enables no speaker
