## ADDED Requirements

### Requirement: One private location reaches only the weather service
The module SHALL take one latitude, longitude and contact from its private section and SHALL send them only to `https://api.weather.gov`. They, and any place the service returns, SHALL NOT appear in state, occurrences, logs, prompt words or the module's database.

#### Scenario: A response names places
- **WHEN** the service returns a city, a grid path, an alert area, a headline and a sender
- **THEN** no message, sync answer, log record or stored row carries any of them or the coordinates

#### Scenario: A malformed section
- **WHEN** a section has an out-of-range coordinate, an unsafe contact or an unknown member
- **THEN** configuration refuses it with a fixed sentence that quotes no value

### Requirement: One synced weather record with its freshness
The module SHALL publish `weather-state/2.0` for entity `local` and serve it by sync. An available record SHALL carry the current hour, up to twelve following hours, active alerts, its observed time, stale time and age, and condition words. Words SHALL come only from a closed vocabulary, a whole temperature and a part of day.

#### Scenario: A healthy read
- **WHEN** the points, hourly and alert reads all succeed
- **THEN** the record is `available` with those fields, and words such as `rain`, `48°F`, `evening`

#### Scenario: A stale copy
- **WHEN** a consumer asks for prompt words at or after the record's stale time
- **THEN** it receives none

### Requirement: Vendor faults are truthful unavailable state
An outage, a timeout, rate limiting, a location outside coverage, a malformed response or a forecast that does not cover now SHALL publish `unavailable` with its reason and the last observation's time and age, and no weather value. None SHALL fail the module. One polling loop SHALL back off to a cap, honour the service's wait within it, publish a repeated fault once and summarize it in logs.

#### Scenario: The service goes away after a good read
- **WHEN** a read fails after an earlier success
- **THEN** the record is `unavailable` with that observation's age and no conditions, forecast, alerts or words

#### Scenario: Repeated failures
- **WHEN** reads keep failing with the same reason
- **THEN** one state is published, one warning is logged, the delay grows to its cap, and one recovery is logged after the next success

#### Scenario: Alerts cannot be read
- **WHEN** the forecast read succeeds and the alert read fails
- **THEN** the record is `unavailable`, because an empty list would claim no alerts

### Requirement: One signal per real change
The module SHALL publish one `weather-changed/2.0` occurrence when the condition, the alert events or the temperature by 10°F or more differ from the last signalled conditions. The first observation, repeated polling, an outage and a restart SHALL signal nothing.

#### Scenario: Rain arrives
- **WHEN** the current condition changes from clear to rain and later polls repeat rain
- **THEN** exactly one occurrence names `condition`

#### Scenario: A restart between polls
- **WHEN** the module restarts and reads the same conditions
- **THEN** no occurrence is published, and a later real change publishes one

### Requirement: Weather takes no device or command authority
The module SHALL take no command, name no device and declare no device simulation. Without a section it SHALL report the ordinary absent state and contact nothing.

#### Scenario: A host-local container section
- **WHEN** the private profile starts with a weather section
- **THEN** it admits the section, because the module reaches no device or local file
