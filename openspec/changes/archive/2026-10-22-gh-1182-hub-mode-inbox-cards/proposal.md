## Why

The approved Hub mode and Inbox designs need reusable implementations on the runtime dashboard. Their current panels expose routine request details on the face and lack a correlated, dismissible mode-issue indicator. This implements [Hub #1182](https://github.com/jimmie-potts/agent-device-hub/issues/1182).

## What Changes

- Extract concise mode, Inbox and Inbox-entry presentation components over existing adapters and shell-owned copies.
- Match mode artwork to the choice; keep selected buttons available for explicit reapplication.
- Replace mode request sections and routine text with a corner Check Inbox control for related issues.
- Correlate mode parents, deterministic device child requests and current Inbox evidence. Clear only after handling or later definitive success; retain history.
- Keep expanded Inbox evidence, typed refusals, authority/revision guards and no-replay behavior.

## Capabilities

### New Capabilities

- `hub-control-cards`: Reusable concise Hub mode and Inbox cards, correlated issue navigation and warning lifecycle.

### Modified Capabilities

- `runtime-dashboard`: Compose the approved Hub controls over existing shared state rather than detailed panel faces.

## Impact

Runtime dashboard presentation/adapters, existing unit and browser journeys, guides and OpenSpec. No API, wire contract, backend owner, storage format, dependency, new host or device participant change. Hosted smoke exercises the affected journeys through its existing CI entry. Installation uses the qualified established-runtime procedure; source and synthetic proof remain separate from installed and physical evidence.
