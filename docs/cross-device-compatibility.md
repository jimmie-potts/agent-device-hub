# Standalone cross-device compatibility

[Hub #9](https://github.com/jimmie-potts/agent-device-hub/issues/9) verifies one
standalone Linux/WSL combination with synthetic input, the real dashboard and
owning consumers. The command and preparation steps are in
[development.md](development.md#bounded-cross-device-compatibility).

## Tested combination

| Input | Revision or version |
| --- | --- |
| Hub product source | `25590e9c95ce334a516d2de0494584d67ea15a26`; this candidate adds verification tooling only |
| Pixoo | `28f4875b7a0f0e57ca6f25d9971e125e927a5503` |
| Nanoleaf shared feed and settings | `f12ac6653a9f3267fa9ef62a2d6667072183d8b3` |
| Runtime | Node 24.21.0, system Python 3.12; Playwright Chromium |
| Wire contracts | Lifecycle/state and controller API `1.0`; `nanoleaf.integration/1.0`; `pixoo-integration/1.0` |

The JSON receipt records package versions, the verified owning-source file lists,
Hub revision and verification-script hashes. No older-version compatibility is
claimed. The Nanoleaf pin combines shared-input and settings code in one source
archive; its shared-input module has the same SHA-256 as the existing #8/#30 pin.

## Source results

The bounded run passes 12 scenarios. Every lifecycle checkpoint compares both
consumer projections with the authoritative snapshot and checks the dashboard's
rendered revision/session count. Recovery additionally requires current consumer
connections, preserves notices and checks Nanoleaf effect epochs/suppression.

| Scenario | Observed result |
| --- | --- |
| Empty state | No sessions in the hub, dashboard or either consumer |
| Two Codex sessions in one project | Distinct identities and matching activity |
| Continuing question and blocked approval | Matching attention, with both meanings visible in the dashboard |
| Turn end | Retained notice without inferred provider read or task success |
| Frontend label and acknowledgment | Shared label applied; dashboard acknowledgment retained; provider read remains unknown |
| Duplicate and prior-turn events | No extra notice/revision; late prior-turn end rejected as stale |
| Claude smoke | One synthetic Claude session reaches both consumers and the dashboard |
| Frontend Nanoleaf settings | Real owner queues and applies the layout setting; physical outcome remains unknown |
| MCP Pixoo mode | Discovered device tool applies Monitor through the real owning controller with simulator transport |
| Disconnected Pixoo | Nanoleaf continues receiving current state; dashboard reports unavailable controller health |
| Pixoo reconnect | Current state returns without automatically reactivating presentation |
| Standalone restart | Labels/notices survive; stale evidence stays uncertain; recovered snapshots do not replay celebrations or restart effect epochs |

The runner closes its owned browser and services and removes disposable state.
Its receipt records cleanup separately and fails if cleanup fails. It refuses to
overwrite an earlier report.

## Existing evidence reused

- [#8](https://github.com/jimmie-potts/agent-device-hub/issues/8):
  `scripts/check-hub-shared-consumers.mjs`, `apps/hub/tests/migration.test.mjs`
  and setup tests own detailed handoff, rollback and credential behavior.
- [#13](https://github.com/jimmie-potts/agent-device-hub/issues/13):
  `apps/hub/tests/mcp.test.mjs` owns protocol, concurrency, replay and failure cases.
- `packages/agent-state/tests/core.test.mjs` and the shared TypeScript/Python
  corpora own detailed provider, ordering, notice and freshness semantics.
- `apps/dashboard/tests/browser.mjs` and `matrix.mjs` own the broader interface,
  concurrent-edit, reconnect and accessibility checks.

## Performance and delivery limits

[#30's report candidate](https://github.com/jimmie-potts/agent-device-hub/pull/135)
is available; its final source delivery remains pending. #9 cannot close until
that completion input is verified. No performance measurement is repeated here.
The performance run used Nanoleaf `5375a3088522507c7f207c6e9c824454db1e1d5f`
and Node 24.20.0/Python 3.14.4. Its results apply to its recorded runtime;
#9 does not relabel them as timing results for this newer settings-capable pin.

This evidence is synthetic source compatibility and fake transport only. It
performs no installation, actual Codex/Claude session, live migration or physical
operation. Separately owned installed/visible receipts are linked by #9 and do
not become new source test requirements. Public guide publication is separate.

## Development attempts

All attempt receipts remain in the delivery evidence; none is overwritten.

1. Missing creation of the disposable Hub state directory caused setup failure.
2. A stale dashboard settings revision produced the expected conflict response.
3. An unnecessary discard-button selector timed out before submission.
4. A test-side observation competed for the hub's single controller slot. The
   owner read now uses the native read API; commands still go through UI/MCP.
5. Settings and MCP passed; the Activity selector omitted its session count.
6. The initial 12-scenario run passed.
7. Added native applied-receipt and Pixoo reconnect assertions passed.
8. A stronger effect-suppression assertion exposed that matching revision alone
   could accept a cached stale consumer snapshot. This run failed, superseding
   the earlier restart evidence.
9. Requiring a current connection and matching freshness passed all 12 scenarios,
   including suppression and unchanged effect epochs after restart.

The final committed-candidate receipt and review/CI results belong in the PR.
These are verification-tool corrections; no product behavior or acceptance target
was relaxed. Since this adds checks for existing behavior, no production-code
red/green change or new product specification is claimed.
