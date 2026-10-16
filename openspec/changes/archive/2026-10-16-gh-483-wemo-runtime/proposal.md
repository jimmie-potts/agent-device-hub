## Why

[Hub #483](https://github.com/jimmie-potts/agent-device-hub/issues/483) needs two configured lamp plugs to work without a vendor app or cloud account. Basic local device qualification is complete; the runtime still needs its own writer and optional maximum-on controls alongside the delivered shared weekly scheduler.

## What Changes

- Add one fixed TypeScript Wemo module for configured F7C063 plugs, explicit identities, bounded local SOAP reads/writes, independent queues, durable command fences and truthful power observations.
- Reuse generic power controls and Hub schedules. Add a narrow explicit hold-release command for power-only devices; an uncertain write is never replayed or cleared by polling.
- Keep maximum-on definitions, observed run starts and expiry dispatch in the Hub, separate from schedules. Use the existing tracked power dispatcher and module writer. Disabled limits send nothing. Enabled limits with unknown elapsed time turn off after a fresh on observation, including after startup/reconnect.
- Show per-plug limit settings, observed age, deadline, enforcement status and command outcome. Label enforcement as Hub-dependent, with no offline guarantee.

## Capabilities

### New Capabilities

- `bunny-wemo`: local-only configured plug identities, observations, queued power commands and explicit uncertain-hold recovery.
- `bunny-power-limits`: independent optional Hub-owned maximum-on settings and conservative run/deadline recovery.

### Modified Capabilities

None. The existing shared scheduler remains protocol-independent and never continuously re-enables an on window.

## Impact

`modules/wemo`, the runtime's existing core automation/store and authenticated management routes, generic dashboard device cards, build/CI discovery and operating guides. Reuse SDK, device families, tracking, outbox and ADR 0012 diagnostics. One bounded XML parser dependency replaces a callback/discovery-oriented client; no new service, listener, broker, native-rule writer or cloud dependency. Installed activation and physical schedule/limit acceptance retain their separate gates under the current runtime upgrade procedure.
