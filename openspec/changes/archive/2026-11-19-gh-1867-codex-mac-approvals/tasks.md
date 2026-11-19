## 1. Wrapper

- [x] 1.1 Add failing wrapper and direct adapter/core cases for an approval cleared at Stop, an approval at Interrupt, subagent start and stop under a known and an unseen parent, a child payload without a usable parent, duplicates and a malformed payload. Evidence: with the previous wrapper, 11 of 35 cases fail in `apps/runtime/tests/mac-codex-hook.test.mjs` and `apps/runtime/tests/core-codex-mac-hooks.test.ts`.
- [x] 1.2 Forward root PermissionRequest with a valid turn, and SubagentStart and SubagentStop with only the parent session and the agent. Evidence: both suites pass; the native wrapper's published messages pass the core's lifecycle 2.0 validator and carry no canary.

## 2. Acceptance and records

- [x] 2.1 Show the approval and the child session in the `mac-codex-local` capture, and keep its exclusions with a child PermissionRequest and an unselected event. Evidence: the capture passes in a fresh run.
- [x] 2.2 Record documented, implemented and actual-client support in `docs/provider-qualification.md`, update the Mac hook guide, and measure the added hook latency on the PC. Evidence: the capability record and the PR's latency table.
