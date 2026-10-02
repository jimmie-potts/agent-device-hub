# Collector source validation

These checks use synthetic data. They do not install a collector, inspect personal
Wispr history, establish installed field semantics or qualify recurring collection.
Independent review, hosted CI and merge evidence belong to the PR.

| Acceptance boundary | Evidence |
| --- | --- |
| Allowlisted, bounded native reads | `reader.test.mjs`, `native.mjs`: required/optional types, transcript canary exclusion, duplicate IDs, lowered row/byte/memory/deadline limits, bounded busy failure, four coherent 1,000-row WAL scans during writes, source preservation and reader lock release. |
| Exact numeric reports | `numeric.test.mjs` and shared contract tests: hand-calculated matching denominators, invalid/null/zero values, zoned timestamp precision, midnight, both DST transitions, presets, app/category filters and active-day runs. Fractional-duration fixtures cover 10,000 and 100,000 retained contributions across 24 hourly groups. |
| Retention and recovery | `store.test.mjs`, `recovery.test.mjs`, `operations.test.mjs`: idempotence, SQLite raw-to-formatted updates and NULL-to-zero-to-positive counters across reopened stores, late edits, pruning/reappearance, failed scans, zone rebuild, clear generations/capture fence, text cleanup, old-backup rejection, explicit historical restore, fresh-directory recovery and capacity preservation. |
| Process ownership and crash boundaries | `supervisor.test.mjs`, `run.test.mjs`: blocked-worker interruption, whole-run deadline, clear cancellation, supervisor death, and process exits before commit, after commit and after publication. A Windows-terminated child is safe; any surviving active worker must retain its guard. |
| Private paths and publication | `config.test.mjs`, `publication.test.mjs`, `native-privacy.mjs`, `native-locked-output.mjs`: source identity, unsafe paths, broad ACLs, junctions, Git roots, ten writable-state hard-link destinations, config/export aliases, source sidecars, Windows short names, sanitized diagnostics, atomic replacement, locked-output preservation and retry. |
| Real CLI and offline consumer | `native-cli.mjs` exercises nine Windows CLI calls; `package-smoke.mjs` exercises extracted collect/status and numeric JSON/CSV exports. The package test imports the shared validator independently without registry access or workspace resolution. |
| Upper row boundary | `native-capacity.mjs`: 100,000 rows produce exactly 100,000 dictations and 1,000,000 words; row 100,001 rejects the whole observation and preserves the prior report. This is a synthetic bound check, not an installed performance promise. |

Node 24 setup, shared build/typecheck, 61 Wispr tests, the offline package test,
410 TypeScript contract tests, four Python contract tests, the isolated contract
package and 18 workflow tests passed after integration of main's contracts 1.2.0.
Shared build/typecheck and workflow checks passed again after integrating the running-build change from main. The workflow inventory is 32 specifications, zero active changes and 72 archives. Python was 3.14.4. The native portable collector suite passed 54 tests and skipped
one Linux-only platform rejection check. Separate native WAL, ACL, production CLI,
locked-output and 100,000-row checks passed under Windows Node 24.21.0 / SQLite
3.53.4. The global Windows runtime was not changed.

Two builds of the final offline artifact produced the same SHA256:
`ce3bc1e543c441ba088084a9d6ef67f3ee7d6f79c92655a6e4eef42a6329ac9e`.
The final native CLI/WAL/ACL/locked-output/capacity checks used that extracted
artifact. The artifact includes the file manifest and installed dependency closure;
its package smoke test passed without dependency installation.

Meaningful failures retained in private delivery evidence include the original
missing modules, absent aggregation memory guard, a Windows EPERM when flushing a
read-only backup handle, and the initial crash fixture's assumption that a child
must survive parent termination. The backup handle now permits flushing only the
collector-owned temporary backup. Source access remains read-only. The ownership
assertion now accepts child termination or completed work while still rejecting an
active unguarded writer. The aggregation guard rejects before a new revision commits.
No source-data, retention or privacy acceptance criterion was weakened.

Correction checks retained a failing fractional-duration fixture and a native hard-link
rejection fixture before their fixes. Totals now reduce finalized cells in the same
order as validation. Writable files with hard links are rejected before a lease or
store opens, and canonical paths enforce containment for Windows short names.
Native checks verify unchanged source bytes and WAL mode after rejection, including
source/config exports and source sidecars. A malformed cell carrying words without
dictations is also rejected by the shared validator.
