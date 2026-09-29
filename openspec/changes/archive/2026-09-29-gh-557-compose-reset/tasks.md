## 1. Pause and operation ownership

- [x] 1.1 Add a portable held-acknowledgment regression and retain its actual red result; implement private pause controls and current receipt/unit/lease validation, then verify both consumers must drain before the owner callback runs.
- [x] 1.2 Add stale nonce, PID, process-start, unsafe-file and expired-lease controls; verify each refuses owner mutation and preserves outstanding pause requests.
- [x] 1.3 Serialize public aggregate operations using the existing recoverable lock; verify live contention has a bounded busy result and an interrupted holder permits cleanup without changing lease-safe thaw behavior.

## 2. Aggregate reset

- [x] 2.1 Adopt accepted consumer pins and implement phase-recorded owner-first reset followed by authorized paired consumer reseeds; verify repeated success, lower revision recovery, responsive paused previews and unchanged identifiers, ports, tokens and frozen proof.
- [x] 2.2 Cover pause, owner, each consumer and readiness failures plus interrupted reset; verify accurate phase/service/state, no premature release or stale readiness, and owner-first stop cleanup before replacement.
- [x] 2.3 Update command help, verification guides and the real-consumer recipe; verify documented commands and negative-control observations match the implementation.

## 3. Acceptance and specification delivery

- [x] 3.1 Run required local build, type, shared contract/workflow and app verification checks; independently inspect the candidate and focused host recipe before qualification, retaining actual results and skip boundaries.
- [x] 3.2 Qualify a committed pinned candidate with real user units and accepted real consumers in disposable roots; retain reset/failure observations, proof hashes, token scans and clean shutdown evidence.
- [x] 3.3 Complete current OpenSpec lookups, synchronize the new capability and archive this change before final independent review; run both workflow checks and report the actual specification inventory.
