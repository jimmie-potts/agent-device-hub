## 1. Selected conversation owner

- [ ] 1.1 Demonstrate a failing private widget read/selection test, then implement explicit persisted selection and bounded latest/history reads. Verify wrong/private conversation, stale revision, restart, correction/removal and no automatic selection with companion tests.

## 2. Dashboard consumer

- [ ] 2.1 Add the labelled Home card, selection controls and separate paged history using shared message presentation. Verify current-only reads, empty/unknown/emotion, access failure, no output, navigation, keyboard, narrow layout and axe in the existing browser journey.
- [ ] 2.2 Add an affected disposable runtime scenario and document the source/installed boundary. Verify public HTTP reads, restart and widget behavior with synthetic data and the existing runtime scenario checks.

## 3. Integration evidence

- [ ] 3.1 Run build, typecheck, lint, companion, dashboard, affected runtime, workflow and browser checks; preserve the meaningful red result and passing results. Synchronize and archive the accepted spec delta before final source reviews; retain exact-head independent Acceptance, review and CI receipts in the PR.
