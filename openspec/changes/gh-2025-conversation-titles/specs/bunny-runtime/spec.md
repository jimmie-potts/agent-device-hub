## ADDED Requirements

### Requirement: Native conversation titles in the core

The core SHALL take a `metadata-observed` observation from the native producer, `bunny/modules/companions`, as it takes Codex Desktop's: it SHALL change only the known root session's title, SHALL establish no session and refresh no lifecycle or restart evidence, and SHALL publish the changed record ([Hub #2025](https://github.com/jimmie-potts/agent-device-hub/issues/2025)). The core SHALL bind `lifecycle/2.3` to the native producer as it binds `lifecycle/2.2`, refusing it from any other source with `forbidden`, and the gateway SHALL refuse `lifecycle/2.3` from every edge credential. The gateway SHALL send an `assistant-control` action as version 2.1 when it is `rename` and as 2.0 otherwise, and SHALL refuse a rename that does not fit its schema with `invalid-request` before dispatch.

#### Scenario: Title metadata
- **WHEN** the companions module sends a title for a conversation the core does not hold, then a lifecycle observation, then a generated title, then an owner title, and the hook sends a title for the same conversation
- **THEN** the first title creates nothing, the core publishes the session with the generated and then the owner's title without moving its lifecycle evidence, and the hook's title is refused as `forbidden`

#### Scenario: Rename through the gateway
- **WHEN** the operator sends an enable and a rename, and renames with an empty, credential-shaped, 81-character or multi-line title or with a task
- **THEN** the enable is dispatched as `assistant-control/2.0`, the rename as 2.1, and every bad rename is refused with `invalid-request` without dispatch
