## 1. Bounded source tooling

- [x] 1.1 Add focused failing tests for percentile calculation, source tampering, forbidden side effects and timeout/failure retention; record expected failures before tooling implementation.
- [x] 1.2 Implement pinned real legacy admission and released-validator measurements; verify committed synthetic outcomes, detached validation and isolated execution without devices. This preparation does not cover the delivered Linux hook.
- [x] 1.3 Add canonical performance checks to development/CI and verify them on supported Python/Node versions. Historical preparation evidence is on PR #77; current-candidate checks must be rerun under 3.1, and repository-wide Windows CI removal remains separate.
- [x] 1.4 Pin the delivered Linux source and complete executed file set from Nanoleaf PR #57; verify hashes, explicit isolated Linux state selection, absence of Windows forwarding and preservation of historical receipt provenance.
- [x] 1.5 Add failing isolation/cleanup regressions, then implement bounded real Linux hook execution. Verify no private state, external network, Windows executable or device access; prove detached descendants are reaped on normal exit, timeout and failure before timing runs.

## 2. Linux evidence and budgets

- [x] 2.1 Record repeated comparable Linux/WSL 1/10/50 synthetic-session profiles with runtime/source identities, fresh-process/new-database and warm-state definitions, raw samples, load/CPU/memory and same-clock timing. Retain failed repetitions and sparse-tail caveats; no native Windows comparison is required.
- [x] 2.2 Measure real Linux hook process launch through return, including stdin parsing, admission/commit and actual Linux worker-spawn handoff. Report component timing, descendant readiness/cleanup and whole-burst completion separately. Exercise isolated contention, invalid input and unavailable state with exit/output evidence; admission-only/no-op-launch timing cannot complete this task.
- [x] 2.3 Freeze numeric p95/p99, hard timeouts, resource/queue/cadence, sampling and tolerance budgets from reviewed Linux evidence, with a checksum-pinned receipt. Mark future feed/consumer queue and cadence verification as integrated gaps rather than measured legacy behavior.

## 3. Early-stage delivery

- [x] 3.1 Run all canonical applicable checks and assess new evidence against every early-stage criterion. Reconcile main, current CI and reviews; list remaining Windows elements for the user and keep repository-wide policy/CI changes separate. Missing Linux evidence remains pending.
- [x] 3.2 Update guide inputs/output and record synchronization; only after early acceptance, obtain current sync/archive lookups, synchronize and archive this scoped early change, then rerun workflow checks. Overall #30 stays open for integrated qualification; installed/physical acceptance stays with device owners.

## Candidate evidence

Linux measurements: `docs/performance/receipts/2026-09-10-linux-hook.json`, nine
passing profiles and 9,000 raw calls. Complete source/tool hashes and the
measured tool commit are in `docs/performance/linux-budgets.json`. Earlier
smoke/interrupted attempts retain separate receipts and exclusion reasons.
Fresh released-validator observations retain 19,800 component samples separately.

Local validation passed on Node 24 and Python 3.14: npm ci, build, typecheck,
controller/lifecycle TypeScript, Python and package checks, MCP unit/protocol/
package checks, performance checks, 13 Linux confinement/failure checks,
workflow validation and all 13 workflow tests. Guide generation, five maintenance
tests and browser checks passed at six viewport widths. The source candidate d3d17e48fb81db9f54a990d15a3cf2e2a6c4933a passed all 13
hosted CI jobs and independent Standards and Specification reviews. Startup
ownership and bounded cleanup findings were resolved. The measured tool commit
and receipt remain unchanged; subsequent supervisor fixes do not change timing
or resource measurement windows. A short current-tool smoke confirmed state and
cleanup, without qualifying new budgets.

Successful current archive/status/specification lookups preceded synchronization
of all four requirements and archival of this early change. Final workflow
validation passed with four main specs, zero active changes and four archives;
all 13 workflow regression tests passed.
Final committed-artifact reviews, current-head CI, guide UI approval and source
merge remain delivery gates. Overall #30 remains open for integrated qualification.
No device or installed-client acceptance is claimed.
