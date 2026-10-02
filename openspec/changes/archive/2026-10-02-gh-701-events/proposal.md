## Why

[Hub #701](https://github.com/jimmie-potts/agent-device-hub/issues/701) defines shared identity and delivery semantics before component adoption. Existing lifecycle, monitor and controller interfaces carry different kinds of evidence; a common envelope must preserve those distinctions.

## What Changes

- Add a versioned B.U.N.N.Y. CloudEvents profile with closed typed payloads, qualified identity/time/order and three delivery classes.
- Add pure TypeScript/Python validators, shared fixtures and reference decisions for recovery, retries and live-only effects, using existing JSON Schema tooling.
- Document the current interface inventory, compatibility/adoption paths, reference traces and retained-notice recovery gaps, including a bounded notification refinement proposal.
- Add validation commands and CI coverage. Record staged adoption in an ADR without changing released contracts or runtime producers.

## Capabilities

### New Capabilities

- `shared-event-contract`: language-neutral event validation, evidence and delivery reference rules.

### Modified Capabilities

None. Existing lifecycle/controller schemas, runtime routes, storage and consumers remain unchanged.

## Impact

New `packages/event-contracts` and `docs/event-contract.md`; architecture/ADR links; root build/test manifest, lockfile and CI. Existing [lifecycle](../../../../docs/agent-lifecycle-contract.md) and [controller](../../../../docs/controller-contract.md) contracts remain the compatibility paths for Python Nanoleaf and TypeScript Pixoo. No broker, store, Effect dependency, event router, notification service or producer adoption is implemented. Installation and physical acceptance are excluded.
