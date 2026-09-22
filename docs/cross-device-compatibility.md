# Standalone cross-device compatibility

[Hub #9](https://github.com/jimmie-potts/agent-device-hub/issues/9) verifies one
standalone Linux/WSL combination with synthetic input, the real dashboard and
owning consumers. The command and preparation steps are in
[development.md](development.md#bounded-cross-device-compatibility).

The tested product source is Hub `36090dd8fa4ec2f7f2fd36145c4b857a940d4474`,
Pixoo `28f4875b7a0f0e57ca6f25d9971e125e927a5503` and Nanoleaf
`80628498136203a8f5fcb06ab5fa306e961e2def`. The runner rebuilds Hub and Pixoo
from the prepared source before importing them. Nanoleaf's shared-input module
has the same SHA-256 as the existing #8/#30 pin; this archive includes the
settings API and, since Nanoleaf #64, the native power, brightness and
saved-scene capabilities with a `scenes` list in the integration snapshot. The
earlier accepted run used Hub `10493718ee01dee78c290294f751829dd60ea91d` and
Nanoleaf `f12ac6653a9f3267fa9ef62a2d6667072183d8b3`; this rerun re-pins Nanoleaf
only. No older-version compatibility is claimed.

## Source results

The bounded run passes 12 scenarios. Every lifecycle checkpoint compares both
consumer projections with the authoritative snapshot and checks the dashboard's
rendered revision/session count. Recovery additionally requires current consumer
connections, preserves notices and checks Nanoleaf effect epochs/suppression.

| Scenario | Observed result |
| --- | --- |
| Source combination | Hub `36090dd`, Pixoo `28f4875`, Nanoleaf `8062849`; full source IDs above and verified files in the JSON receipt kept with the companion PR for Nanoleaf #64 |
| Runtime and packages | Node 24.20.0, Python 3.14.4, Playwright Chromium; device-contracts, agent-lifecycle-contracts and device-mcp `1.0.0`, agent-state `2.0.0`; hub `0.2.0` |
| APIs | Lifecycle/state and controller `1.0`, `nanoleaf.integration/1.0`, `pixoo-integration/1.0` |
| Empty state | No sessions in the hub, dashboard or either consumer |
| Two Codex sessions in one project | Distinct identities and matching activity |
| Continuing question and blocked approval | Matching attention, with both meanings visible in the dashboard |
| Turn end | Retained notice without inferred provider read or task success |
| Frontend label and acknowledgment | Shared label applied; dashboard acknowledgment retained; provider read remains unknown |
| Duplicate and prior-turn events | No extra notice/revision; late prior-turn end rejected as stale |
| Claude smoke | One synthetic Claude session reaches both consumers and the dashboard |
| Frontend Nanoleaf settings | Real owner queues and applies the layout setting; physical outcome remains unknown. The disposable worker fixture discovers no scenes, so the extension snapshot carried an empty `scenes` list through the extended validator; populated lists are covered by the hub's own validator tests |
| MCP Pixoo mode | Discovered device tool applies Monitor through the real owning controller with simulator transport |
| Disconnected Pixoo | Nanoleaf continues receiving current state; dashboard reports unavailable controller health |
| Pixoo reconnect | Current state returns without automatically reactivating presentation |
| Standalone restart | Labels/notices survive; stale evidence stays uncertain; recovered snapshots do not replay celebrations or restart effect epochs |
| Reused migration/setup checks | [Shared consumer check](../scripts/check-hub-shared-consumers.mjs), [migration tests](../apps/hub/tests/migration.test.mjs), [setup tests](../apps/hub/tests/setup.test.mjs) |
| Reused protocol/provider checks | [Host MCP](../apps/hub/tests/mcp.test.mjs), [core semantics](../packages/agent-state/tests/core.test.mjs), [TypeScript/Python contract commands](development.md#controller-contract-checks) |
| Reused frontend checks | [Browser scenarios](../apps/dashboard/tests/browser.mjs), [browser matrix](../apps/dashboard/tests/matrix.mjs) |
| Performance input | [Delivered #30 report](https://github.com/jimmie-potts/agent-device-hub/blob/8411413fa43329dba6e25acc4cb715ffbba7887f/docs/performance/standalone-2026-09-22/README.md), including the final acceptance run and retained failed attempts |
| Installed-client and physical evidence | Not performed by this suite; retain separately owned receipts linked by #9 |

The runner closes its owned browser and services and removes disposable state.
Its receipt records cleanup separately and fails if cleanup fails. It refuses to
overwrite an earlier report.

Reused coverage is linked to [#8](https://github.com/jimmie-potts/agent-device-hub/issues/8)
and [#13](https://github.com/jimmie-potts/agent-device-hub/issues/13).

## Performance and delivery limits

[#30's delivered report](https://github.com/jimmie-potts/agent-device-hub/blob/8411413fa43329dba6e25acc4cb715ffbba7887f/docs/performance/standalone-2026-09-22/README.md)
merged in PR #135 as `8411413fa43329dba6e25acc4cb715ffbba7887f`. All six
merged-main checks passed and #30 closed. Its final acceptance run measures Hub
`d9f5e7e1129f048f8caee046f8f6644e043ec6e2`; earlier reports remain historical
attempts. This satisfies #9's required performance-report input. No performance
measurement is repeated here.
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

Independent candidate review identified missing preflight receipts, stale build
provenance and a Pixoo shutdown timeout that could leave an owned process alive.
Focused negative checks demonstrated the missing receipt and verify forced exit
and reaping of an unresponsive fixture. The runner now records preflight failure,
rebuilds before imports and supervises its own Pixoo process. These changes do not
alter device/runtime behavior or qualify production recovery.
