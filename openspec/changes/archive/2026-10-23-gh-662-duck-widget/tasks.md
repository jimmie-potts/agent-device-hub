## 1. Selected conversation owner

- [x] 1.1 Demonstrate a failing private widget read/selection test, then implement explicit persisted selection and bounded latest/history reads. Verify wrong/private conversation, stale revision, restart, correction/removal and no automatic selection with companion tests.

## 2. Dashboard consumer

- [x] 2.1 Add the labelled Home card, selection controls and separate paged history using shared message presentation. Verify current-only reads, empty/unknown/emotion, access failure, no output, navigation, keyboard, narrow layout and axe in the existing browser journey. Cover stopped metadata sync, unsupported calendar timestamps and long legacy text.
- [x] 2.2 Add an affected disposable runtime scenario and document the source/installed boundary. Verify public HTTP reads, restart and widget behavior with synthetic data and the existing runtime scenario checks.

## 3. Integration evidence

- [x] 3.1 Run build, typecheck, lint, companion, dashboard, affected runtime, workflow and browser checks; preserve the meaningful red result and passing results. Synchronize and archive the accepted spec delta before final source reviews.

Independent Standards, Specification and Acceptance verdicts, hosted CI, guarded merge and merged-main checks remain delivery gates recorded in the PR. They follow the final archived candidate and are not waived by artifact completion.
