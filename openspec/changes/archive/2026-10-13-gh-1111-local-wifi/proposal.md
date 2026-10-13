## Why

[Hub #1111](https://github.com/jimmie-potts/agent-device-hub/issues/1111) lets the owner view and control the existing dashboard from iPhone Safari on home Wi-Fi while the PC runs. The responsive dashboard already exists; it needs an authenticated local HTTPS entry.

## What Changes

- Add one optional Wi-Fi proxy origin and shared-secret digest to the runtime edge configuration, preserving its loopback listener.
- Let that authenticated owner connection use existing browser read/control sessions, with HTTPS cookies and unchanged origin, expiry, logout and stream behavior.
- Document a removable native Windows Caddy setup with one owner password, local certificate trust and one restricted TCP port.
- Verify refused requests, existing local clients, browser controls and reconnect behavior using synthetic data; keep installed phone evidence separate.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `bunny-runtime`: admit one explicitly configured, authenticated HTTPS proxy entry for browser sessions.
- `runtime-dashboard`: reuse current sign-in and control behavior through that entry.

## Impact

Runtime edge configuration, listener admission, browser gateway tests and setup documentation. No frontend implementation, SDK protocol, storage format, device owner, new account system or public endpoint. Caddy is a separately run setup tool, not an npm dependency. Tailscale replacement remains in #1117.
