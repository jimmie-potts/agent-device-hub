## Why

[Hub #5](https://github.com/jimmie-potts/agent-device-hub/issues/5) needs an optional standalone owner so shared monitoring can outlive the Pixoo backend. The owner selected native Linux in WSL; this change does not qualify or alter a Windows runtime.

## What Changes

- Compose the released agent-state core in `apps/hub` with private durable storage, authenticated loopback transport and explicit readiness/shutdown.
- Preserve [Pixoo's selected session source](https://github.com/jimmie-potts/divoom-app-upgrade/issues/31), including revisioned reads, labels, acknowledgment and quiesce.
- Route bounded controller requests through existing APIs and finite integration extensions. Keep failure and health independent per device.
- Provide fenced export/import, readiness-gated activation and rollback evidence without shared databases or implicit fallback.
- Package the application reproducibly and exercise fake controllers, process restart, privacy, authentication and failure cases.

## Capabilities

### New Capabilities

- `standalone-hub-host`: Linux standalone state ownership, authenticated transport, controller routing and explicit migration.

### Modified Capabilities

None. Shared controller v1, lifecycle v1 and durable export v1 stay unchanged.

## Impact

Adds `apps/hub`, host validation/package commands and CI coverage, plus architecture/development/work-guide updates. Consumes Hub #3/#4, Pixoo #31/#37 and [Nanoleaf #49](https://github.com/jimmie-potts/codex-nanoleaf/issues/49). [Pixoo #33](https://github.com/jimmie-potts/divoom-app-upgrade/issues/33) supplies the delivered monitor settings integration. No personal configuration, installed hooks, live state, physical device or public publication changes are authorized.
