## 1. Owner expiry

- [x] 1.1 Expire sessions after 24 hours without lifecycle evidence from maintenance, startup and ingest, and refuse late or end-only admissions. Evidence: all six original tests in `packages/agent-state/tests/retention.test.mjs` failed before the owner change and pass afterward. They cover capacity beyond 128 lifetime identities, the boundary, renewal, restart, the timer, late and end-only observations, an expired parent, and a migrated store without due journal rows. Mutating the boundary, ingest expiry, startup expiry, session-driven timer, end-only rule or late-observation rule each fails a test. After review, tests also cover a late observation to a live session, a corrected clock jump, survivors keeping labels, notices and attention through expiry, and journal pruning of a renewed session. The floored-clock comparison and both survivor-stripping mutants each fail a test.
- [x] 1.2 Update tests whose assertions depended on indefinite retention or ancient fixture timestamps. Evidence: the journal cap and timer tests assert expiry; four Hub fixtures use `Date.now()`.

## 2. Documentation and packages

- [x] 2.1 Document expiry in the agent-state guide and architecture, and publish agent-state 2.0.3 and Hub 0.2.3.

## 3. Delivery

- [x] 3.1 Run the agent-state, Hub, shared build/type, controller, lifecycle, MCP and workflow checks; sync and archive this change. Record exact results in the PR.
