## 1. Admission and container profile

- [x] 1.1 Add failing runtime and container tests for private browser/machine access and preserved local/Wi-Fi refusal behavior.
- [x] 1.2 Implement explicit proxy configuration, shared origin admission and protected browser-session routing.
- [x] 1.3 Add the opt-in private container profile and operator validation without widening the local default.

## 2. Proxy and verification

- [x] 2.1 Add the loopback Caddy configuration and focused real-proxy/browser journey, including forged proof, machine scopes and reconnect without replay.
- [x] 2.2 Update owning setup/development/architecture guides and affected capability scenarios.
- [x] 2.3 Run applicable build, type, lint, contract, workflow and affected runtime/SDK/browser/container checks.

Source review, guarded merge, installation and actual-client acceptance remain tracked by [#1117](https://github.com/jimmie-potts/agent-device-hub/issues/1117). Archiving this source change does not complete those obligations.

Source checks: Node 24 build, lint and typecheck passed; runtime 822 passed with three unavailable Linux namespace/full-disk probes skipped; SDK 376, controller contracts 410, event contracts 190, workflow 243 and container/operator 39 passed. Private and existing Wi-Fi Caddy/Chromium journeys passed. The independent review found an SDK admission bypass; a failing stream regression reproduced it, and shared HTTP/SDK admission plus call-route coverage resolved it. Actual Tailscale and client acceptance remain pending on the issue.
