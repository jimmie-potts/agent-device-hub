## 1. Browser output

- [x] 1.1 Implement the qualified local voice driver with bounded discovery, final eligibility checks, one submission, truthful completion/cancellation and no replay; verify fake-synthesis tests for delayed voices, changed permission, missing start, errors, Stop, mute and timeout.
- [x] 1.2 Add the declared profile-2.0 endpoint, playback and dispatch families with schema validation; verify valid examples and malformed or mismatched command rejection in event tests.

## 2. Authenticated endpoint

- [x] 2.1 Implement connection-bound SDK handlers and receipts without automatic restore; verify raw-call authorization, principal/connection mismatch, closure and reconnect alongside existing remote conformance tests.
- [x] 2.2 Add the narrow gateway grant, connection-loss occurrence and scoped dashboard endpoint handle; verify two-tab isolation, read-only refusal, unmount and disconnect cleanup in runtime/dashboard tests.

## 3. Companion coordination

- [x] 3.1 Add the core's internal tracked speech adapter and module responsibility/outcome persistence; verify refusal, full disk, lost receipt, restart and outbox recovery without replay.
- [x] 3.2 Admit speech from newly admitted live opportunities with one active and one pending candidate; verify coding priority, deduplication, final checks after waits, separate social allowance, Quiet/mute and scenario silence with a fixed clock.
- [x] 3.3 Add accessible explicit enablement, manual-availability explanation, mute, Stop and truthful endpoint/playback status; verify keyboard, two tabs, stale state, disconnect and axe in the existing companions browser journey using fake audio.

## 4. Integrated source evidence

- [x] 4.1 Update the owning guides and validation instructions; verify root build/type/lint, shared contract/workflow checks and affected event/SDK/runtime/companions/dashboard suites, recording the specification inventory.
- [x] 4.2 Run a disposable runtime journey through real gateway and browser controls with synthetic events; verify the selected endpoint only, positive coding alert, negative policy cases, Stop/mute and no replay after restart.

After these implementation tasks, follow the repository's synchronization,
archive, independent review, CI and merge gates. Those revision-specific receipts
belong in the PR. The issue continues to own source closeout and the separately
selected installed acceptance; completing this implementation checklist does not
complete delivery.
