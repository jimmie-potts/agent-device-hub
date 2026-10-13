## MODIFIED Requirements

### Requirement: Evidence-bound samples and map captures

The collector SHALL attach only samples it actually observed within a defensible run window, with missing intervals and ambiguous association shown explicitly. Returning observations SHALL remain retained and SHALL NOT extend the cleaning window used for association beyond its cleaning observations. A pause, charge, returning or offline observation alone SHALL not complete a run. After an observed run end backed by matching record evidence, it SHALL request a bounded current map and retain the candidate run, capture times, map identity/sequence and association checks privately. A capture SHALL never be promoted to verified run attribution solely from unchanged status or summary; absent a separately qualified rule or device-side join, coverage SHALL remain unverified.

#### Scenario: Observed run with partial battery evidence
- **WHEN** matching record evidence resolves an observed run with a collection gap
- **THEN** its detail contains only observed eligible samples, explicitly shows the gap and invents no missing points

#### Scenario: Candidate map captured in the observed window
- **WHEN** a matching run ends and the current-map read succeeds with consistent pre/post observations
- **THEN** the original map and association evidence are retained as a candidate capture, while coverage remains unverified

#### Scenario: Failed, delayed or ambiguous capture
- **WHEN** map retrieval fails, completes after its bounded window, crosses an observation gap or conflicts with a newer run
- **THEN** the run's supported totals remain and its map availability reports missing or unverified rather than attributing another run's map

#### Scenario: Run discovered after downtime
- **WHEN** startup reconciliation discovers a historical run that the collector did not observe ending
- **THEN** it retains the record without fetching a current map as that run's historical map or inventing battery samples

#### Scenario: Cleaning record ends before return-to-dock finishes
- **WHEN** an observed cleaning run has a completed matching record, followed by returning observations after its reported end and an evidenced dock boundary
- **THEN** the run retains only eligible observed battery samples, admits its bounded current-map capture with unverified association, and preserves returning originals without extending the cleaning window or guessing a clock offset

#### Scenario: Returning without observed cleaning
- **WHEN** the collector first observes only returning activity after a historical completed record has ended
- **THEN** those later observations do not associate that old record with new samples or trigger its historical map capture
