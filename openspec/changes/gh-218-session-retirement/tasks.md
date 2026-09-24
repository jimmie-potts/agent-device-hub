## 1. Owner retirement and continuity

- [x] 1.1 Demonstrate a failing normalized Desktop end scenario, then implement atomic parent/known-descendant removal, released capacity and one revision; retain provider mapping and unknown/repeated end checks.
- [x] 1.2 Implement bounded durable retirement guards and fresh generations; verify delayed events, same-identity resume, old ends after resume, child admission, count/age bounds, restart, failed commits and legacy import through focused state tests.
- [x] 1.3 Verify ordinary completion, input waits, read/acknowledgment, freshness uncertainty and a turn beyond thirty minutes retain records, with the existing fake-clock 24-hour expiry suite passing.

## 2. Host admission and compatibility

- [x] 2.1 Add optional bounded read-only archive admission using existing configuration; test positive evidence, no configuration, missing/unreadable folders, delayed events and new work after unarchive, plus retirement without archive access.
- [ ] 2.2 Expose opt-in snapshot 1.1 while preserving default 1.0, update shared TypeScript/Python schemas/fixtures and package versions, and pass package and host restart/migration checks. Obtain independent contract/task review before dependent consumer adoption.
- [ ] 2.3 Verify Nanoleaf assignment release and fresh local task/effect defaults when retirement is missed, using a scoped consumer companion where required. Verify Pixoo/Tidbyt current monitoring and dashboard removal, empty idle and reconnect with focused owning-source/browser checks; preserve unavailable-feed behavior.

## 3. Documentation and source validation

- [ ] 3.1 Update affected lifecycle/state/host guides, compatibility assessment and required development/CI checks; refresh the work guide through its maintenance procedure and verify generated output/browser checks.
- [ ] 3.2 Run all applicable build/type, controller/lifecycle/state, MCP, Hub/setup, Tidbyt, dashboard, workflow and package checks from this worktree; retain commands/results and actual OpenSpec inventory outside the candidate.

## 4. Acceptance and delivery gates

- [ ] 4.1 After separate installation and named-device authorization, qualify throwaway archive and non-archive ends plus resume; record installed-client timing, dashboard removal, visible Nanoleaf Line release and fresh monitoring separately from source tests.
- [ ] 4.2 After complete applicable acceptance and successful current lookups, synchronize affected specifications and archive before final independent Standards/Specification review. Current-head CI, guarded merge, merged-main checks and issue readback remain the subsequent SDLC gates.
