## ADDED Requirements

### Requirement: Bounded capture freshness checkpoints

The foreground producer SHALL report bounded exceptional checkpoints to its existing stderr for separately observed native dequeue, feature publish attempt and publish acknowledgment. Core capture SHALL report its own accepted-feature freshness loss and recovery with bounded evidence. Neither checkpoint SHALL affect capture behavior or include audio or private identifiers.

#### Scenario: Publication acknowledgment stops progressing

- **WHEN** a synthetic capture continues delivering native frames while an existing publication remains pending through the observation window
- **THEN** the producer reports evidence of the separate stages without asserting delivery to core or Nanoleaf and without retrying the publication
