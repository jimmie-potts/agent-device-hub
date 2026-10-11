## Why

[Epic #1054](https://github.com/jimmie-potts/agent-device-hub/issues/1054)'s live Sony trial found valid receiver-hosted artwork on HTTP port 58080, while its control API uses another port. The accepted same-origin check rejects that thumbnail before fetching it; the owner approved allowing this single verified service port on the configured receiver IP.

## What Changes

- Admit absolute HTTP artwork URLs on the configured receiver origin or the same configured receiver IPv4 address at port 58080.
- Keep every other host and port refused, with no credentials, fragments, redirects or DNS discovery.
- Preserve acquisition bounds, observation association, diagnostics, source preference and text fallback.
- Add a cross-port regression and refusal coverage using synthetic receiver URLs.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `runtime-playback`: allow the verified Sony thumbnail service without allowing arbitrary ports or other hosts.

## Impact

Only the playback acquisition URL boundary, its tests and owning documentation/specification change. No wire schema, dependency, browser policy, device writer or runtime configuration change is needed. Source review and CI precede the established-runtime upgrade; actual artwork and physical display acceptance remain the epic's own gates. Private receiver replies, media and camera frames remain outside Git/GitHub.
