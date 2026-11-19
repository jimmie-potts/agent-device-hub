## ADDED Requirements

### Requirement: Position evidence for measured playback

Playback SHALL make the original observation bounds and associated item, process, presentation, and discontinuity available to authorized alignment consumers. A consumer SHALL treat missing position, stale evidence, an unsupported state, inconsistent observation bounds, and an unavailable source as unqualified for measured replay. Current-state reads and reconnects SHALL send no playback command.

#### Scenario: Playback position becomes stale

- **WHEN** a position remains available in the consumer's copy past its original freshness boundary
- **THEN** measured alignment becomes unavailable even if no replacement observation arrives

#### Scenario: Reordered position after a seek

- **WHEN** an older observation arrives after a newer seek observation
- **THEN** the current playback position remains tied to the newer evidence
