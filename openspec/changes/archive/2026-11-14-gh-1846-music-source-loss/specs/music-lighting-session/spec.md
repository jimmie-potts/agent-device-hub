## ADDED Requirements

### Requirement: Playing input loss appears in private diagnostics

When a playing session ends for loss of its input, the worker SHALL report the first locally observed retirement cause and bounded last accepted evidence if available. This SHALL preserve the existing ending, restoration and permanent retirement.

#### Scenario: Different losses have the same safe ending

- **WHEN** a synthetic missing-feature expiry or subscription overflow ends a playing session
- **THEN** diagnostics distinguish the observed local condition while both cases follow the existing source-loss ending and restoration rules
