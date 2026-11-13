## ADDED Requirements

### Requirement: Explicit core standby container

Production and private-proxy containers SHALL admit explicit standby under
their existing profile checks. Standby SHALL start only the core and serve
local health with the general gateway off. The defaults and behavior of
enabled and disabled control SHALL remain unchanged.

#### Scenario: Settings-only startup
- **WHEN** an operator selects standby with valid private configuration and an available runtime lease
- **THEN** local status can read core health and the gateway stays off through startup and reload, including with a valid edge block

#### Scenario: Unsupported standby options
- **WHEN** standby selects an unsupported profile, producer or device option, or supplies an invalid core, diagnostic or edge configuration
- **THEN** startup refuses before state preparation or work intake
