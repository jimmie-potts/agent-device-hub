## 1. Owner rule

- [x] 1.1 Forget no-ID approvals on retired turns in the reducer and settle stored ones at startup. Evidence: `packages/agent-state/tests/approvals.test.mjs`. The clear-on-new-turn, late-marker and startup tests failed before the change and pass after it, and the current, unselected, request-ID and question/input guards pass. Removing the reducer call, including request-ID approvals, dropping the approval-only guard, widening to any non-current turn or removing startup settlement each fails a test. One current-status test that checked attention surviving selection now uses a request-ID approval.

## 2. Documentation and delivery

- [x] 2.1 Document the rule in the agent-state guide, and publish agent-state 2.0.4 and Hub 0.2.4.
- [x] 2.2 Run the agent-state, Hub, shared build/type, controller, lifecycle, MCP and workflow checks; sync and archive this change. Record exact results in the PR.
