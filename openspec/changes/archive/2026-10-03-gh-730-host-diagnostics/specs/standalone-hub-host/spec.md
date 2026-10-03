## ADDED Requirements

### Requirement: Opt-in operational diagnostics
The normal Hub host SHALL support explicit private diagnostic configuration for canonical lifecycle/error logs and useful authenticated HTTP/MCP, controller and owned background-operation traces. It SHALL preserve readiness/result stdout, authentication, device queue ownership and uncertain outcomes. The #730 coverage inventory SHALL identify actual boundaries and deferred coverage.

#### Scenario: Normal host diagnostics enabled
- **WHEN** the host starts with diagnostics enabled and serves an authenticated synthetic command
- **THEN** lifecycle and request/controller outcomes are queryable on the diagnostic channel and correlate to sampled spans without changing command effects or readiness output

#### Scenario: Host diagnostics absent or collection unavailable
- **WHEN** configuration omits diagnostics or an enabled backend is unavailable
- **THEN** domain outcomes and existing command timeouts are preserved and no duplicate operation is attempted

#### Scenario: MCP and owned background work
- **WHEN** an authenticated MCP action or an important owned background action completes or fails
- **THEN** registered outcome metadata identifies that boundary without body capture or invented source/trace context
