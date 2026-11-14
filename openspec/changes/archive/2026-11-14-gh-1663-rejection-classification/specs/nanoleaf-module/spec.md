## ADDED Requirements

### Requirement: Generic local HTTP read rejection classification

The module SHALL classify generic rejections from existing timed GETs using fixed rejection stages and categories. Classification SHALL be private to the invocation. It SHALL preserve original error identity and request settlement. Reads outside the owned diagnostic adapter SHALL report unknown unless they supply explicit invocation provenance. Summary and recovery SHALL retain counts for each observed class within the failed run.

#### Scenario: Mixed rejection classes before recovery
- **WHEN** timed reads from one source reject with different request error categories and recover before a periodic summary
- **THEN** the INFO recovery carries both classification counts and original timing evidence

#### Scenario: A reused error crosses request boundaries
- **WHEN** a classified read and an unclassified read reject with the same error object
- **THEN** only the classified invocation carries the known stage and category, and both retain their original error as cause
