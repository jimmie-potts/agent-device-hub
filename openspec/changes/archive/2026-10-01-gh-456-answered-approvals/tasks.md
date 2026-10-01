## 1. Owner and producer

- [x] 1.1 Map Claude `PostToolUse`/`PostToolUseFailure` to known-ID `attention.resolved` and forget same-turn no-ID approvals on a known-ID resolution or turn end. Evidence: `packages/agent-state/tests/approvals.test.mjs` and `providers.test.mjs`. The resolution, turn-end, Codex turn-end, duplicate, unmarked-resolution and mapping tests failed before the change and pass after it; the later-approval, request-ID and question/input guards pass. Removing either reducer call, widening to any kind, to known IDs or to any turn, or accepting a missing turn each fails a test. The #225 next-turn test drops its `Stop` step, so it still proves next-turn retirement when no `Stop` fires, and one retention bystander now holds an input request instead of an approval that its own turn end would clear.

## 2. Setup and hook

- [x] 2.1 Generate the two events for Claude sources, accept and upgrade an installed previous-generation receipt, and raise the packaged hook's stdin bound to 8 MiB. Evidence: `apps/hub/tests/setup.test.mjs` (upgrade, interrupted upgrade, Codex list) and `setup-hook.test.mjs` (a 1 MiB `PostToolUse` payload resolves attention) failed before the change and pass after it.

## 3. Documentation and delivery

- [x] 3.1 Update the provider-qualification and lifecycle-contract docs, the agent-state and setup guides, and publish agent-state 3.4.0 and Hub 0.4.1.
- [x] 3.2 Run the agent-state, Hub, shared build/type, controller, lifecycle, MCP and workflow checks; sync and archive this change. Record exact results in the PR.
