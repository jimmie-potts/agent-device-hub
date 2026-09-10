## Why

[Hub #30](https://github.com/jimmie-potts/agent-device-hub/issues/30) needs measured early evidence and numeric limits before shared-core implementation. Nanoleaf's fresh Linux runtime is source-delivered in [PR #57](https://github.com/jimmie-potts/codex-nanoleaf/pull/57); its Linux hook replaces the previous Windows/WSL comparison and executable-forwarding requirements.

## What Changes

- Retain bounded source tooling, exact provenance, raw samples and explicit clock boundaries.
- Measure the real Linux hook in Ubuntu WSL with synthetic neutral events and isolated Linux storage. Repeat comparable 1/10/50-task profiles on that route; no native Windows run or forwarding measurement is required.
- Separate full hook return, process startup, admission/commit and background-worker handoff. Keep released Python/Node validator measurements as distinct component evidence.
- Freeze reviewed latency, resource, queue and timeout budgets from repeatable Linux observations before Hub #3 implementation.
- Keep integrated qualification pending until the shared feed and consumers exist. Overall #30 stays open after early delivery.

## Capabilities

### New Capabilities

- `shared-monitor-performance-baseline`: Reproducible Linux source measurements, evidence completeness and frozen budget requirements.

### Modified Capabilities

None in this replan. Shared contract platform wording and repository-wide CI support policy require separate reconciliation; this change does not silently revise released contracts.

## Impact

The September 10 replan edits planning and performance documentation only. Existing measurement code, source pins and raw receipts remain unchanged and do not establish full Linux hook coverage. Future implementation must pin the delivered Linux source, prove isolation, then collect new evidence. Nanoleaf [#55](https://github.com/jimmie-potts/codex-nanoleaf/issues/55) owns installed and physical acceptance; it is not a prerequisite for isolated source measurements.

Windows interop availability no longer blocks this early stage. Repository-wide Windows CI removal and CI cost reduction are separate work. Remaining Windows references in shared policy, source and historical receipts must be reported to the user, not treated as implicit permission to retain a Windows runtime requirement. [Hub companion PR #99](https://github.com/jimmie-potts/agent-device-hub/pull/99) uses current main because PR #77 predates the delivered Linux guide.
