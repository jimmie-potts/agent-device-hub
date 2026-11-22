## ADDED Requirements

### Requirement: Admit explicit local artwork display

The runtime SHALL require authenticated control for uploads and Show. Private previews SHALL require read access. Display SHALL use a compatible configured target and the existing command tracker and writers.

#### Scenario: Unavailable display after save

- **WHEN** a selected device becomes unavailable after the save commits
- **THEN** the saved item remains in the library and the display attempt reports its own outcome
