## ADDED Requirements

### Requirement: Request-linked Wemo power readback

The owner SHALL perform one bounded power read in the plug's writer queue after its acknowledged write. It SHALL associate the reported power or unavailability with the same request and publish it through device state.

#### Scenario: The plug reports its power

- **WHEN** an on or off write is acknowledged and the matching plug answers its read
- **THEN** readers can obtain the returned power for that request, including an opposite reading
- **AND** the write still produces one tracked outcome

#### Scenario: A write reply is lost

- **WHEN** a write may have reached the plug but its reply was lost
- **THEN** the plug remains held even if a later poll reports the requested power
- **AND** no command is replayed after restart
