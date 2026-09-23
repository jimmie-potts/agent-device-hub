## Why

[Hub #179](https://github.com/jimmie-potts/agent-device-hub/issues/179) closes the gap between BUNNY's token login and an installed browser credential. The local user should open BUNNY with one launcher action while Hub API authorization stays scoped.

## What Changes

- Add an owner-only Linux channel that issues short-lived, single-use browser launch codes.
- Add an `open` command that requests a code from the running Hub and opens its loopback page with the code in the URL fragment.
- Exchange the code for a time-limited, memory-only browser bearer with read/control access to configured aliases. Retain the manual token path for direct visits.
- Revoke launcher sessions on disconnect, expiry, authority replacement and shutdown.
- Verify the host, browser and packaged consumer with disposable state and fake controllers.

## Capabilities

### Modified Capabilities

- `unified-dashboard`: One-click local owner launch and automatic browser connection.
- `standalone-hub-host`: Private launch channel and bounded scoped browser sessions.

## Impact

Changes Hub, CLI, dashboard, tests and guides. No controller wire or MCP machine contract changes, personal installation, hook edit or device operation is included. The UI change requires current-candidate human approval before merge.
