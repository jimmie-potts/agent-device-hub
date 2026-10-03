## Why

[Hub #733](https://github.com/jimmie-potts/agent-device-hub/issues/733) needs to turn supported diagnostic findings into reviewed, installed fixes. The owner selected cross-repository delivery, so maintenance must use the same execution owner as [dotfiles #9](https://github.com/jimmie-potts/dotfiles/issues/9), rather than start another delivery coordinator.

## What Changes

- Add a bounded maintenance intake command that reads the existing canonical Hub journal records, retains private evidence, groups findings and records incomplete coverage.
- Investigate findings against current source and existing issues through the installed planning skill; only supported proposals can create or reuse an issue. Reassess North Star, architecture and existing patterns at pickup.
- Submit exact repository/issue identities under a named maintenance grant to the shared supervisor. The supervisor owns serial delivery, independent reviews, merge/CI, installation verification and recovery.
- Reconcile uncertain issue creation and queue submission before retrying. Produce a private report distinguishing findings, issue creation, queue admission and verified delivery evidence.
- Preserve ADR 0011 retention and publication boundaries. Keep original accepted records privately, with separately sanitized public explanations and no automatic age-based evidence deletion.

## Capabilities

### New Capabilities

- `maintenance-intake`: bounded diagnostic intake, supported issue proposals, deduplication, private evidence, supervised handoff and honest reporting.

### Modified Capabilities

None. The existing observability 1.1 contract is consumed unchanged; this change does not widen capture or add a second exporter.

## Impact

New TypeScript command and tests under `apps/maintenance`, root build/type/test wiring, focused Depot checks, an owning operations guide, the shared-supervisor command/JSON boundary and a narrow Hub manual-claim instruction pointer. No Hub runtime API or device behavior changes. The first activated telemetry source remains Hub. Nanoleaf and Pixoo keep their owning upgrade work and later eligibility. Source tests and isolated integration evidence belong here; [#734](https://github.com/jimmie-potts/agent-device-hub/issues/734) owns installed scheduling, exact-host controls and one real telemetry-backed delivery through verified installation.
