## ADDED Requirements

### Requirement: Reusable quiet Roborock card

Home and the Roborock status page SHALL reuse the same read-only card with a persistent vacuum illustration, Status, Last run and Care tabs, a corner warning disclosure and History navigation. Tab changes SHALL preserve card dimensions and the illustration. Existing saved Home placements SHALL remain valid. Small and wider placements SHALL retain the card format and expose observed state and battery; the run and care tabs SHALL expose the additional summaries. Detailed observations and paged run/sample evidence SHALL remain reachable without filling the default card with technical text. The interface SHALL support keyboard access, narrow screens, both themes and reduced motion.

#### Scenario: Home and module-page reuse
- **WHEN** the owner opens the configured vacuum on Home or the Roborock page and changes tabs
- **THEN** the same card presentation is used, its image and dimensions stay stable, and no command is sent

#### Scenario: Passive history and evidence
- **WHEN** the owner opens History or the full observations disclosure
- **THEN** existing bounded run/sample views remain usable and navigating back sends no vacuum command

#### Scenario: Unconfigured or refused source
- **WHEN** the module is unconfigured, refused or unavailable and has no generic device record
- **THEN** Home still offers a Roborock card whose unavailable disclosure does not invent a target, battery or normal state

### Requirement: Source-bound card evidence

The card SHALL use the existing authenticated shell participant, owner-addressed sync and bounded module content reads. It SHALL validate target, document and envelope identities and monotonically ordered records. Conflicting equal revisions SHALL invalidate current evidence until an explicit reload or fresh scope. Obsolete reads and callbacks SHALL NOT replace the selected source. Leaving the card SHALL close its scoped copies and reads without closing other consumers. A local display clock SHALL age evidence without polling the Hub or robot.

#### Scenario: Superseded or conflicting input
- **WHEN** a lower revision, conflicting equal revision, wrong target or late response from an old scope arrives
- **THEN** it cannot establish current card data, no raw response or exception is rendered, and only the owning registered refusal code is disclosed

#### Scenario: Reconnect and cleanup
- **WHEN** the card is hidden, unmounted, re-entered or reconnected
- **THEN** it releases retired scopes, syncs current membership on the existing shell participant and sends zero device commands

### Requirement: Truthful compact Roborock measurements

Current state and battery SHALL age from their retained observation timestamp, independently of service health. Status observations older than 120 seconds, missing timestamps, future timestamps or a lost status stream SHALL NOT be described as current. Care usage SHALL use its own observation time and SHALL NOT become fresh from a newer status observation. Current cleaning counters SHALL appear only with fresh cleaning activity. Other state codes SHALL remain numeric instead of acquiring unqualified dock, charge or completion labels. The latest recorded run SHALL be the retained run with the greatest reported start time, independently of archive insertion/reconciliation order. Its owning read SHALL return at most one validated record without accepting caller-selected sorting or arbitrary queries. It SHALL retain its robot-reported time with unqualified-clock context, duration and distinct cleaned-area measurement; a known end time SHALL NOT establish completion without complete code 1. Missing measurements SHALL remain unknown. Care SHALL show recorded usage without invented remaining life, deadlines or maintenance thresholds. Nonzero evidenced error/dock codes SHALL use the corner disclosure without invented meanings.

#### Scenario: Stale observation and independent care age
- **WHEN** the display clock passes the status age bound or care is older than the current status
- **THEN** stale evidence is labelled and disclosed without inventing a new reading or running a periodic content read

#### Scenario: Independent run fields and completion
- **WHEN** the last record has different reported-area and cleaned-area fields or lacks complete code 1
- **THEN** the card uses cleaned area without substituting reported area and does not label that record completed

#### Scenario: Unknown values and safe warnings
- **WHEN** a field is missing, a vendor code is unfamiliar or a read fails
- **THEN** unknown values and fixed refusal context remain distinguishable from zero, normal operation and an empty history

#### Scenario: Older history reconciled after a newer run
- **WHEN** an older run is saved after a newer run
- **THEN** Last run still selects the greatest reported start time while existing history pagination keeps its order and the latest-run read returns only that one record
