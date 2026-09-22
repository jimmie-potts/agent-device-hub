## Context

See proposal.md for motivation. Existing Hub scripts verify pinned Pixoo and Nanoleaf owning code. Dashboard tests provide browser selectors, and host MCP tests provide protocol initialization and command helpers. #30 is independently producing the performance report required for final acceptance.

## Goals / Non-Goals

Test one standalone configuration using synthetic Codex and Claude lifecycle metadata, the real dashboard and owning consumers. No runtime feature, wire contract, installation or physical operation changes. No repeated migration or performance suite.

## Decisions

- Keep this as verification tooling with `skip_specs: true`. A design is warranted by cross-process setup, cleanup and consumer recovery, although product requirements are unchanged.
- Run the standalone host against a new temporary store. Prepare exact pinned source archives in separate temporary directories; rebuild Hub and Pixoo before importing their build output. Record source cleanliness and script hashes. Use simulator transport and the existing Nanoleaf disposable owning-service fixture, suppressing physical worker launch.
- Observe lifecycle state through both owning consumers and the dashboard. Assert identity, attention/notices and read-evidence semantics. Exercise both interface routes against the actual owning command handlers.
- Use bounded waits for asynchronous consumer/browser updates. Reserve the report before preflight. Supervise owned child handles, terminate an unresponsive process group and await exit before deleting temporary state. Record failed execution instead of replacing it with a success result.
- Reuse component tests for exhaustive edge cases. Require a small shared scenario set for duplicates, late events, one disconnected consumer and restart. Reference migration/MCP suites by source path.
- #30 is a required report input for final acceptance, not an input to these independent checks. Do not archive, merge or close #9 without the required acceptance evidence.

## Risks / Trade-offs

- Fake physical boundaries cannot establish visible results. The report marks installed-client and physical acceptance as separate.
- Separate source archives require local preparation. CI can run local verification checks without private cross-repository credentials; the recorded owning-source run remains required delivery evidence.
- Concurrent #30 work may change shared scripts or package/CI files. Keep new helpers scoped to compatibility and reconcile source inputs before review; avoid editing its files.
- Missing report or failing consumer behavior leaves acceptance incomplete; do not repair unrelated owning products under this issue.

## Migration Plan

Not applicable. This change adds source verification and does not migrate a runtime.
