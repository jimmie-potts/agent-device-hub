## ADDED Requirements

### Requirement: Explicit producer lifecycle selection
Setup input SHALL accept an optional `lifecycleVersion` of `1.1` or `1.2` and reject other values. Producer staging in the supervised owner migration SHALL keep its existing 1.1 limit. The installed hooks SHALL produce the selected envelope version, and a configuration without the field SHALL keep lifecycle 1.0. An installed receipt SHALL NOT change its selected version in place.

#### Scenario: Selecting lifecycle 1.2
- **WHEN** a reviewed setup with `lifecycleVersion:"1.2"` is applied for a Claude source
- **THEN** its producer emits lifecycle 1.2 envelopes, while existing receipts and configurations keep their versions
