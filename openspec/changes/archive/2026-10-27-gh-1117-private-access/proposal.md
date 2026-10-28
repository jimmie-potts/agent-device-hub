## Why

[Issue #1117](https://github.com/jimmie-potts/agent-device-hub/issues/1117) lets one owner open the Mac-hosted dashboard at home or away while the PC is off. The accepted Mac profile currently serves only local clients.

## What Changes

- Add one explicitly configured private HTTPS proxy entry for existing browser sessions and scoped machine clients.
- Use Tailscale Serve on the Mac for private HTTPS and a loopback Caddy forwarder for owner browser authentication and authenticated proxy proof.
- Add an opt-in container access profile that preserves local access, disabled devices, private volumes and manual operation.
- Document installation, removal and focused verification. Keep source tests separate from actual phone/computer evidence.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `bunny-runtime`: Admit the selected private HTTPS entry without weakening local or temporary Wi-Fi admission.
- `runtime-dashboard`: Reuse existing sign-in, expiry and reconnect behavior through the private entry.

## Impact

Runtime configuration/listener/gateway, container entrypoint/operator, proxy configuration and owning guides/tests. No SDK wire or shared contract changes, new state owner, database migration or device writer. #566 owns actual producer enrollment; #1112 owns TV permissions and rendering; #568 owns state/device transfer.
