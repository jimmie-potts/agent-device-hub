## Why

[Hub #426](https://github.com/jimmie-potts/agent-device-hub/issues/426) allows each surface to apply the owner-approved content policy from #424 separately. This change delivers the Tidbyt tile and ADR 0005 device-control policy. The Tidbyt tile currently ignores the title and project display metadata supplied by snapshot 1.2.

## What Changes

- Prefer the owner-selected label, title, project display name, legacy project ID, then neutral hash in Tidbyt rows.
- Request snapshot 1.2 from the Tidbyt runner through the existing shared feed; leave other consumers on their current default.
- Supersede ADR 0005's media-title and filename exclusion while preserving bounded contract fields and credential exclusion.


## Capabilities

### Modified Capabilities
- `tidbyt-agent-status`: consume bounded title/project metadata within the existing layout.

## Impact

Tidbyt renderer, runner, shared feed and their tests; ADR 0005. Existing build, typecheck, Tidbyt, agent-status, LIFX, contract and workflow suites cover these paths. Source only; no configuration, installed process, account or device changes. The current Tidbyt candidate needs human UI approval before merge.

## Remaining issue work

The moment title fixture and ADR 0006 remain open acceptance in Hub #426, awaiting the canonical event owner's handoff under #335. The task/repository image-search policy for divoom #94 also remains outside this PR. This partial delivery does not close #426 or satisfy those criteria.
