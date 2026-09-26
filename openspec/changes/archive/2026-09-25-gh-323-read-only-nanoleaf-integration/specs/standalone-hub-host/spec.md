## ADDED Requirements

### Requirement: Read-only Nanoleaf integration snapshot
The host SHALL accept a `nanoleaf.integration/1.0` snapshot that marks any of `settings.set`, `elements.assign`, `task.assign` and `project.color` as `{supported: false, scope: "control"}`, as the owner reports for a device other than the Lines ([codex-nanoleaf#113](https://github.com/jimmie-potts/codex-nanoleaf/issues/113)). Every other key SHALL keep its exact closed validation. `mode.set` SHALL remain `supported: true` with the controller v1 route, and a capability with any other scope, an extra key or a non-boolean `supported` SHALL answer `incompatible-controller`. The host SHALL NOT add a route or filter extension commands by capability. Maps to [Hub #323](https://github.com/jimmie-potts/agent-device-hub/issues/323).

#### Scenario: Reading the Lines and the Panels
- **WHEN** an authorized client reads the integration snapshot for a Lines alias and a Panels alias that share one owner endpoint and credential
- **THEN** each returns the owner's validated snapshot for its own device, both controllers stay ready, and the owner sees only the native credential

#### Scenario: Malformed unsupported capability
- **WHEN** the owner marks a configuration operation unsupported with another scope, an extra key or a string value, omits one of the four, or marks `mode.set` unsupported
- **THEN** the snapshot answers `incompatible-controller` without passing the response on
