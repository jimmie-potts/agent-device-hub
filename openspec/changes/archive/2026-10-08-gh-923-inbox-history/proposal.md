## Why

[Hub #923](https://github.com/jimmie-potts/agent-device-hub/issues/923) needs one shared place for failed, uncertain and conflicting operations and a filtered view of retained history. The accepted runtime tracker and dashboard provide the ownership and presentation seams.

## What Changes

- Derive durable inbox items in tracker transactions; handling records its actor and deletes the shared item.
- Explicit send-again atomically handles the original with a new tracked operation, then sends once.
- Add filtered gateway history reads, MCP inbox/history/handling tools and dashboard inbox/timeline views.
- Replace fixture history copies with the real history observation.

## Capabilities

### New Capabilities
- `shared-inbox-history`: operation inbox, explicit handling/resend and filtered history surfaces.

### Modified Capabilities

None.

## Impact

Runtime core/gateway/dashboard and focused catalog seams; additive event inbox conflict/handling contracts. No SDK framework, migration, installation or physical-device change. Source-only; installation remains #840.
