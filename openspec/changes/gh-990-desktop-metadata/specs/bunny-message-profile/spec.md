## ADDED Requirements

### Requirement: Desktop metadata in the existing lifecycle family

The `lifecycle/2.0` family SHALL accept `event.kind` `metadata-observed` with an optional boolean `event.archived` and the existing optional `title`; at least one SHALL be present. This input SHALL use Codex Desktop identity, unknown turn and ordering, and unknown or top-level parentage. It SHALL carry no label, project, project ID, host session ID, native event ID or occurrence instant. It SHALL use the existing occurrence envelope, type and routing, without a new family or a lifecycle 1.x conversion. The core SHALL accept this input only from `bunny/modules/codex-desktop`, and a remote participant SHALL NOT impersonate that reserved module source.

#### Scenario: Metadata without fabricated lifecycle evidence
- **WHEN** the trusted Desktop module publishes an archive boolean, a valid existing-format title, or both for a Codex Desktop session
- **THEN** the input is valid in the existing lifecycle family, without asserting activity, read evidence, notices or a known turn

#### Scenario: Invalid metadata shape
- **WHEN** metadata has neither archive nor title, another provider or client, known turn or ordering, child parentage, or a forbidden lifecycle field
- **THEN** validation refuses it with `invalid-message`

#### Scenario: Source cannot be forged
- **WHEN** another source publishes otherwise valid Desktop metadata, or a remote participant attempts to claim the reserved Desktop module source
- **THEN** the core or remote admission refuses it before it can change metadata or admission
