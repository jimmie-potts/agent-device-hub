## MODIFIED Requirements

### Requirement: Bounded exact ranking rebuilds

The collector SHALL calculate each supported preset/corpus ranking from every eligible retained contribution while limiting simultaneously active intermediate ranking keys to 250,000 across the current working partition’s app/category groups and ranking kinds. A preset/corpus batch exceeding one working partition SHALL be divided into a bounded set of disjoint key partitions before rejection. Merging those partitions SHALL preserve exact global top-100 rankings, omitted counts, distinct-dictation support, coverage and comparison measures. Completed partitions and batches SHALL release their intermediate counts before the next batch. A cumulative number of keys processed across completed batches SHALL NOT alone reject a snapshot. Initial import, repeat collection, reporting-zone rebuild and recovery SHALL retain exact support, counts, sorting, top-100 limits and omitted counts. Existing source, command, working-memory, private-store and publication limits SHALL remain enforced. Exceeding an active partition after bounded subdivision or another resource limit MUST fail visibly and preserve the prior committed snapshot and retained state.

#### Scenario: Overlapping presets exceed the former cumulative limit

- **WHEN** valid retained text produces more than 250,000 keys cumulatively across presets/corpora but no active batch exceeds its limit or another resource budget
- **THEN** the collector publishes all exact supported tables, including terms that qualify only after multiple dictations

#### Scenario: A large batch fits bounded partitions

- **WHEN** a valid preset/corpus batch exceeds 250,000 combined ranking keys but its bounded disjoint working partitions and other budgets fit
- **THEN** collection publishes exact merged rankings and omitted counts without duplicating coverage or comparison measures

#### Scenario: One active batch exceeds capacity

- **WHEN** a working partition still exceeds 250,000 app/category ranking keys after bounded subdivision
- **THEN** collection reports aggregate-capacity, preserves the last-good snapshot and retained contributions, and does not truncate rankings or discard history

#### Scenario: Replay and reporting changes

- **WHEN** the same retained records are processed again or their reporting zone changes
- **THEN** every batch reads the same coherent retained state and preserves distinct-dictation counts, coverage, unknown finality and the applicable preset boundaries
