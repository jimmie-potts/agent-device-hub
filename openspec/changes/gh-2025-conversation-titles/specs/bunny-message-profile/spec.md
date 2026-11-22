## ADDED Requirements

### Requirement: Conversation title contracts

The package SHALL register `lifecycle/2.3` and `assistant-control/2.1` ([Hub #2025](https://github.com/jimmie-potts/agent-device-hub/issues/2025)). `lifecycle/2.3` SHALL be `lifecycle/2.2` with `metadata-observed` admitted for the native assistant source as well as Codex Desktop; a native `metadata-observed` SHALL carry a `title`, SHALL carry no `archived` state and, as every `metadata-observed`, SHALL have unknown turn and ordering, unknown or top-level parentage and no label, project, project ID, host session ID, native event ID or occurrence instant. `assistant-control/2.1` SHALL be `assistant-control/2.0` with the action `rename`, which SHALL carry a `profile` and a `title` of 1 to 80 Unicode scalar values of session display text, and no task or message; every other action SHALL carry no profile or title. A test SHALL keep `lifecycle/2.3` equal to `lifecycle/2.2` apart from these members.

#### Scenario: Native title metadata
- **WHEN** the companions producer sends a native `metadata-observed` with a title in `lifecycle/2.3`, in `lifecycle/2.2`, without a title, with `archived`, with a known ordering, and with a credential-shaped title
- **THEN** only the first is valid, and Codex Desktop's metadata stays valid in 2.3

#### Scenario: Rename command
- **WHEN** an `assistant-control/2.1` rename names a profile and a title, omits either, adds a task, carries 81 characters or a credential, or is sent as 2.0
- **THEN** only the first is valid, and the 2.0 actions stay valid in both versions
