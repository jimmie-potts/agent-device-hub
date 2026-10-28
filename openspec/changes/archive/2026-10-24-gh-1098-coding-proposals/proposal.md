## Why

[Issue #1098](https://github.com/jimmie-potts/agent-device-hub/issues/1098) adds useful next-check advice to the delivered fixed-text Reachy page. A turn ending proves no test result; deliberate structured evidence lets the owner inspect and copy a grounded prompt.

## What Changes

- Add an ephemeral form for one synced session and explicitly named task, check statuses, observation time, owner-reported revisions and evidence references.
- Show deterministic next-check text or an evidence gap, with current Reachy policy and conservative freshness/supersession checks.
- Copy only after an explicit click and final validation. No capture, storage, provider, submission, audio or execution.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `bunny-companions`: deliberate structured coding evidence and inspect/copy suggestions.

## Impact

Module-local browser code, common companion presentation guards, companion tests and the existing hosted browser journey. Existing core SDK sync supplies session/mode/settings; no owner boundary, shared contract, provider or state-store change. Source-only; installation remains #643. Architecture reviewed: no topology change.
