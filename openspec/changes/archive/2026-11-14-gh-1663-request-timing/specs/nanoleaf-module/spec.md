## ADDED Requirements

### Requirement: Local HTTP read timing

The module SHALL record bounded elapsed time and the winning completion branch for its status sampler, Music admission and live Music reads. A bounded local timer SHALL distinguish observed callback lateness from an overdue callback still pending as the read settles. The record SHALL omit observed callback lateness when zero callbacks completed. A stopped read SHALL release its timing state. A recovery SHALL preserve terminal failure counts and observed or pending callback-delay maxima across the preceding failure run. Timing SHALL preserve the existing request sequence, deadlines, errors and availability.

#### Scenario: Overlapping reads with different terminal branches
- **WHEN** the sampler and a live Music read overlap and one reaches the link deadline while the other receives an HTTP error
- **THEN** each timing record identifies its source and winning branch, and their original domain behavior is preserved

#### Scenario: A callback is late but still pending
- **WHEN** a read settles after a diagnostic probe was due but before its callback ran
- **THEN** timing records the pending delay separately from completed callback observations

#### Scenario: A short run contains different failures
- **WHEN** one read rejects in transport and the next reaches the link deadline with callback delay, and a read succeeds before a periodic summary is due
- **THEN** the INFO recovery identifies both observed terminal branches by count and carries the failure run's callback-delay maxima separately from the successful read's timing
