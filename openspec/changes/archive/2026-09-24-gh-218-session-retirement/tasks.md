## 1. Owner retirement and continuity

- [x] 1.1 Demonstrate a failing normalized Desktop end scenario, then implement atomic parent/known-descendant removal, released capacity and one revision; retain provider mapping and unknown/repeated end checks.
- [x] 1.2 Implement bounded durable retirement guards and fresh generations; verify delayed events, same-identity resume, old ends after resume, child admission, count/age bounds, restart, failed commits and legacy import through focused state tests.
- [x] 1.3 Verify ordinary completion, input waits, read/acknowledgment, freshness uncertainty and a turn beyond thirty minutes retain records, with the existing fake-clock 24-hour expiry suite passing.

## 2. Host admission and compatibility

- [x] 2.1 Add optional bounded read-only archive admission using existing configuration; test positive evidence, no configuration, missing/unreadable folders, delayed events and new work after unarchive, plus retirement without archive access.
- [x] 2.2 Expose opt-in snapshot 1.1 while preserving default 1.0, update shared TypeScript/Python schemas/fixtures and package versions, and pass package and host restart/migration checks. Obtain independent contract/task review before dependent consumer adoption.
- [x] 2.3 Verify Nanoleaf assignment release and fresh local task/effect defaults when retirement is missed, using a scoped consumer companion where required. Verify Pixoo/Tidbyt current monitoring and dashboard removal, empty idle, reconnect and generation-scoped draft reset with focused owning-source/browser checks; preserve unavailable-feed behavior.

## 3. Documentation and source validation

- [x] 3.1 Update affected lifecycle/state/host guides, compatibility assessment and required development/CI checks; reconcile the work guide with concurrently maintained main and preserve that guide tree without a separate publication.
- [x] 3.2 Run all applicable build/type, controller/lifecycle/state, MCP, Hub/setup, Tidbyt, dashboard, workflow and package checks from this worktree; retain commands/results and actual OpenSpec inventory outside the candidate.

## 4. Acceptance and delivery gates

- [x] 4.1 Qualify the separately authorized installed archive-end path, recording owner timing, dashboard removal and visible Nanoleaf Line release. Record the approved native non-archive/reopen/live-resume qualification follow-up in [Hub #253](https://github.com/jimmie-potts/agent-device-hub/issues/253); source fresh-resume checks remain in this change.
- [x] 4.2 Reconcile the approved qualification boundary with the issue, obtain successful current specification/archive lookups, and verify every affected delta against its main specification before synchronization.
- [x] 4.3 Verify the Nanoleaf companion's accepted read/idle retention and device-local Evict behavior through focused source and browser checks, renewed UI approval and separately authorized installed verification. Preserve owner presence and the approved qualification boundary; document the deferred cross-device command.

After these acceptance tasks are complete, synchronize every affected specification and archive this change before final independent Standards/Specification review. Current-head CI, guarded merge, merged-main checks and issue readback remain mandatory SDLC gates. Native non-archive/reopen/live-resume qualification is deferred only as approved in Hub #253.
