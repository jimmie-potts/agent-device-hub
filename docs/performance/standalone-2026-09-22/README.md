# Standalone source qualification, September 22, 2026

The corrected candidate passes the personal-project scope of [Hub #30](https://github.com/jimmie-potts/agent-device-hub/issues/30). This is source evidence from synthetic input and disposable state. It does not qualify an installed agent client or a physical device. Source review, PR CI and merged-main verification remain separate delivery gates.

## Sources and method

Measured Hub commit: `e7136a9c6cb73a059c71afea06d870477c98a5aa`, clean before preparation. Pixoo: `28f4875b7a0f0e57ca6f25d9971e125e927a5503`. Nanoleaf: `5375a3088522507c7f207c6e9c824454db1e1d5f`. Subsequent receipt/guide/specification edits do not change the measured tooling. The compressed runtime manifest identifies every staged regular file and symbolic link; its uncompressed SHA-256 is in the report.

The host was x86-64 WSL2, kernel `6.6.87.2-microsoft-standard-WSL2`, Node `v24.20.0`, Python `3.14.4`, system npm `9.2.0`, and Playwright Chromium headless shell `153.0.8010.12`. Runtime hashes, timestamps and before/after system load are in [report.json](report.json). Host contention was observed, not controlled. Dependency setup and builds ran in a separate supervised namespace before the timed run; both phases verified cleanup. Only locked registry tarballs and sanitized cache metadata were copied into preparation. No inherited environment or personal configuration was available to build scripts. See [the runbook](../../performance-standalone.md) for the single command and prerequisites.

The driver measures spawn-to-close hook duration and forwarding-start-to-consumer-response duration on its own monotonic clock. Receipt includes the proxy and projection/IPC overhead. Pixoo refresh and the real Nanoleaf poller use one-second cadence. Two profiles each contain 200 warm events. The first call and startup are separate. No p99 inference is made from this sample size.

## Result

| Profile | Hook p95 | Pixoo receipt p95 | Nanoleaf receipt p95 |
| --- | ---: | ---: | ---: |
| One active task, 200 events | 56.18 ms | 721.56 ms | 983.35 ms |
| Ten concurrent tasks, 200 events | 87.43 ms | 766.61 ms | 969.67 ms |

Targets were fixed before measurement: hook p95 250/500 ms, consumer receipt p95 1,500 ms, hard hook return 3,000 ms, startup/recovery 5,000 ms and Hub RSS 256 MiB. The cadence-based consumer target was corrected to 1,500 ms before any run; no target changed after a measured failure.

All 487 hooks returned within the hard deadline. The maximum was 2,911.16 ms in the deliberately held-input outage case. Peak Hub process RSS was 153.40 MiB. Startup took 246.77 ms; consumer recovery 971.46 ms; host restart plus consumer readiness 1,390.46 ms. The short burst admitted all 50 events, reported zero rejection/loss, and recovered current state. It did not force admission overflow or establish sustained 50-task throughput. An expired subscription cursor produced explicit resync; canonical host tests cover queue rejection and subscription bounds.

All eleven scenarios passed: confinement, startup, burst, stalled third consumer, unavailable Nanoleaf consumer, dashboard connection/reconnection, concurrent integration control, exclusive owner, host outage, restart and no expired replay. Both real consumers continued receiving during a guarded Pixoo monitor filter change through the Hub, real Pixoo controller, ControlService and MonitorPresentation. A dashboard label edit was retained across restart with notices. Pixoo produced 227 fake display frames by the control checkpoint through its sole Player; Nanoleaf populated actual activity rows with its physical worker suppressed. These are fake transport/projection observations, not optical evidence.

The namespace init exited and cleanup was verified. The measured runtime could not access the host home, Windows mount or external network. Tests additionally cover detached descendants on success and timeout, nonzero exit, oversized output, invalid timeouts and escaping package links.

## Attempts and corrections

[attempts.json](attempts.json) indexes every attempt and the hashes of its compressed raw report. All eight smoke runs are non-qualifying by design, even when their scenarios pass.

- Smoke 1–2: the observer forwarded the wrong Host header, which the Nanoleaf feed rejected. Corrected the observer header.
- Smoke 3–4: the driver incorrectly required a turn ID despite the reducer correctly retaining uncertainty without ordering evidence. Match admitted revision, session and observed-event timestamp instead.
- Smoke 5: the driver used a nonexistent Sources button. Updated it to the delivered Connections view and the actual label button text.
- Smoke 6: all original scenarios passed with incomplete sample counts.
- Smoke 7: all scenarios passed after adding the real Pixoo integration control and fake Player frames, still with incomplete counts.
- Full attempt 1 at `a4327b99c2f2ca322bc3d307e18e21a1b93c94e7`: exited zero and verified cleanup but lost its larger JSON payload because immediate process exit truncated buffered stdout. It remains a failed qualification, with no usable percentile evidence. A 300 KB pipe regression now verifies the awaited write; the supervisor rejects a missing result explicitly.
- Full attempt 2: the stdout correction retained all samples and passed its numeric checks. Q1 review subsequently found that preparation was outside confinement and the dashboard scenario did not prove an observed reconnect. Its raw qualified flag remains unchanged, but this receipt does not satisfy those final acceptance checks.
- Smoke 8: the confined preparation and explicit reconnect corrections passed all scenarios with incomplete counts. Its evaluator also labeled the insufficient hook count `hard-deadline`; that was a completeness diagnostic, not an exceeded deadline. The evaluator now names incomplete counts separately.
- Full attempt 3 at the measured revision above: both preparation and measurement cleanup passed. The dashboard observed disconnection, opened a second feed, and received post-outage revision 473 in 796.38 ms. All unchanged targets and scenarios passed. This is the acceptance run after specific review fixes, not a favorable selection from unchanged reruns.

Review findings Q1-STD-001 and SPEC-Q1-001 are addressed by the confined build/cache tests and explicit reconnect observations. No historical baseline, budget or Pixoo #61 receipt was rewritten. The original development failures and full attempt 1 remain failures.

## Validation and delivery boundaries

Node 24 local checks passed: build/typecheck; TypeScript/Python contracts, lifecycle and agent-state suites and package consumers; MCP service/protocol/package and host MCP; Hub and packaged Hub; setup; baseline performance; dashboard type/unit/browser; workflow checks and fixtures; Linux baseline isolation; and standalone qualification tests. The new tests include nine Python cases and four Node cases. Pin-specific Pixoo regressions passed 37 tests across remote monitoring, presentation, media rendering and media storage. Nanoleaf shared-input regressions passed 39 tests, including stale/reconnect, preserved epochs and source selection. Tests use fake transport or disposable state.

OpenSpec `gh-30-standalone-qualification` adds three requirements and six scenarios. Its stale global context still calls hosting/UI proposed and mentions a Windows worker; current source, issue scope and repository instructions control this Linux-only qualification. No migration or production rollback plan applies. The guide records source evidence separately from installation and public publication.
