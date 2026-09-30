## Why

[Hub #426](https://github.com/jimmie-potts/agent-device-hub/issues/426) permits real names on Hub surfaces under the owner-approved #424 policy. Its remaining moment surface can now extend the canonical event intake delivered by #358. The prior Tidbyt and ADR 0005 changes remain delivered.

## What Changes

- Add optional bounded pull request titles, repository names and meeting titles to normalized events and their private automation-log projection.
- Supersede ADR 0006's title and image-query exclusions, keeping credential and contact-detail exclusions.
- Verify named moment fixtures, legacy events/log rows, restart, duplicate/replay behavior and strict validation.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `hub-automation`: allowlisted event display metadata and private log readback.

## Impact

The existing Hub intake, log JSON detail, tests, application guide and ADR 0006 change. Controller contract 1.1, its sender, device writers, lifecycle producers and published lifecycle/state artifacts remain unchanged. No installation, live migration, UI change or device operation is involved. Prompt/response/transcript capture remains Hub #425.
