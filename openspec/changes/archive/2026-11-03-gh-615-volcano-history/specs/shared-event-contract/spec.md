## ADDED Requirements

### Requirement: Volcano observation family

The contract SHALL register the `volcano-observation` occurrence family (Hub #615): type `org.bunny.volcano-observation.observed`, dataschema `https://bunny.invalid/events/volcano-observation/2.0`, on `bunny.event.volcano-observation.<feed ID>`, where the feed ID is the lowercase hex SHA-256 of the feed's sorted `client`, `hostId`, `provider` and `sourceId` in UTF-8 JSON and the envelope's subject SHALL be that ID. Its payload SHALL be exactly `feed` (`provider: storz-bickel`, `client: volcano`, `hostId`, `sourceId`), `observedAtMs`, `collectorEpoch`, `sequence` (a non-negative integer per epoch), `link` (`connected`, `disconnected`, `unavailable` or `identity-mismatch`) and `reading`. `reading` SHALL be null unless the link is connected, and otherwise exactly `status1` and `status2` (16-bit unsigned), `currentDeciC` and `targetDeciC` (degrees Celsius times ten, or null) and `heatingHours` and `heatingMinutes` (or null). It SHALL carry no serial, Bluetooth address or firmware. The core SHALL take no change from the family.

#### Scenario: Valid and invalid snapshots
- **WHEN** a snapshot has the feed's subject and a reading on a connected link, and others have a wrong subject, another provider, a reading on a disconnected link, an extra member, a serial, a register over 16 bits or no epoch
- **THEN** the validator accepts the first and rejects each of the others with a fixed safe error
