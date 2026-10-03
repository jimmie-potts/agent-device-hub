# Source validation

The source candidate uses synthetic data only. Native Windows Node 24.21.0 and
SQLite 3.53.4 qualified the extracted 1.1.0 package; this does not qualify the
installed Wispr schema, personal data, scheduling or Hub installation.

| Accepted behavior | Evidence |
| --- | --- |
| Separate corpora, missing/partial/ambiguous observations, unchanged edits, snippet expansion and full rewrite | `language.test.mjs`, `language-reader.test.mjs`, `operations.test.mjs` |
| Unicode/case/apostrophes, stopwords, repetitions, supported language, bounded alignment | `language.test.mjs`; unknown detected language cannot fall back to a configured preference |
| Exact preset rankings and subgroup suppression before top-100 | `language-aggregate.test.mjs`; globally frequent term absent from every daily top-100 still ranks first |
| Repeat, restart, late edits, pruning, incompatible algorithms/policies and timezone changes | `store.test.mjs`, `operations.test.mjs` |
| Clear, pending publication, opt-out, managed backups and numeric restore | `recovery.test.mjs`, `operations.test.mjs`; native CLI and locked-output tests |
| Sensitive patterns and source preservation | `language.test.mjs`, `language-reader.test.mjs`, existing reader/native/privacy suites |
| Numeric dictionary/snippet snapshots and counter segments | `dictionary.test.mjs`, `operations.test.mjs`; unsupported measures remain null and windows unknown |
| Current collector output through authorized Hub routes | `tests/wispr_hub_producer.test.mjs`; four presets, three corpora, matching app/category selection, numeric-default export and text revocation |
| Offline package and Windows boundaries | Extracted `package-smoke.mjs`, `native.mjs`, `native-privacy.mjs`, `native-cli.mjs`, `native-locked-output.mjs`, `native-capacity.mjs` |

The current collector suite passed 93 tests; the Hub suite passed 246 tests.
Shared build/type checks, TypeScript/Python contracts and contract package tests
passed. Workflow checks and 18 workflow tests passed after archival: 34 main
specifications, no active changes and 74 archived changes. Required PR/main CI and the
independent Standards/Specification reviews remain delivery gates.

The first native language qualification caught a CLI early return that bypassed
opt-out when collection was disabled. Removing that return lets the owned
operation revoke text before reporting the disabled collection; the same native
check then passed. A malformed managed-backup regression also failed before the
new status-revocation ordering and passed afterward. Red/green logs and native
package digests are retained in the coordinator's canonical evidence directory.

A maximum-size sensitivity-filter regression exposed repeated scanning that took
about two seconds per input. The bounded-match fix reduced the three-input test
to milliseconds; the complete package and Windows qualification passed again.

Independent review regressions cover numeric/language eligibility, overlapping
owner exclusions and denial-status preservation after capacity failure or
interruption. All three failed before correction and passed afterward.

The tested package SHA256 is
`e706b5ae1e1b4b2100d7ee06bdd82e5fe6193d9340d677e8a999fb4dc14bf301`.
Repackage or renew native qualification if packaged source changes. One skipped
native-suite test is the Linux-only rejection case; the Windows entrypoint itself
requires Windows and cannot skip platform qualification.

The README defines the controlled field profile and its limits. No fixture proves
that an observation was sent, why text changed, the owner's speaking habits or an
undocumented counter window. Those remain outside source acceptance.
