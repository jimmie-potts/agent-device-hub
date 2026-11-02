## Why

[Issue #1364](https://github.com/jimmie-potts/agent-device-hub/issues/1364) separates reviewed source integration from release qualification and installation. Repeated full browser catalogs on draft updates and every merge delay independent work.

## What Changes

- Introduce explicit focused admission for explicitly listed existing dashboard/frontend CSS assets, retaining build/type/lint, affected unit and consumer checks, independent review and disposable acceptance.
- Keep conservative coverage for backend, shared, unknown and safety-sensitive changes and for gate-policy changes.
- Skip expensive checks while a PR is a draft. Run broad qualification on pinned integrated snapshots through #1363 with one active and newest pending run.
- Remove strict up-to-date-build admission after the replacement gate is verified. Preserve guarded merges, current comparison review and conflict checks.
- Document concurrent disposable environments and supported isolated client experiments. Feature work links the separately owned deployment batch.
- Give the MicroDuck and Reachy browser journeys private per-invocation proof outputs, closing their shared-path bypasses of the existing per-task receipts convention.

## Capabilities

### New Capabilities

- `focused-source-admission`: deterministic focused admission and separate integration, release and installation evidence.

### Modified Capabilities

None.

## Impact

CI selection, GitHub Actions triggers, delivery preflight, branch status requirements, AGENTS.md and SDLC/development instructions. Depends on delivered #1321 and verified #1363 before activation. No installed runtime or device change.
