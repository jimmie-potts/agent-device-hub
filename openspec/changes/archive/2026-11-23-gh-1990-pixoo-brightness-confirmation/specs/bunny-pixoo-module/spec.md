## ADDED Requirements

### Requirement: Request-linked brightness reading

The Pixoo owner SHALL perform one bounded brightness read after an acknowledged brightness write, within the same writer ordering. It SHALL publish the fresh reading or its unavailability through device state and preserve the tracked write evidence.

#### Scenario: Acknowledged write with a read

- **WHEN** a tracked brightness write is acknowledged
- **THEN** the writer reads the display before admitting a newer brightness write and associates the reading with the approved request
- **AND** an unrelated frame upload cannot substitute for or erase the reading

#### Scenario: A lost reply

- **WHEN** the device write reply is lost
- **THEN** the write remains uncertain and does not run again
