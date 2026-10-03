## 1. Opt-in analysis core

- [x] 1.1 Document the source-check and CI mapping, then add an opt-in configuration/analysis regression and retain its expected pre-implementation failure.
- [x] 1.2 Implement versioned normalization, apostrophe handling, sensitivity/exclusion boundaries, word/useful-word and 2–5-token phrase features; verify Unicode, repeated occurrence versus distinct support, canaries and deterministic fixtures.
- [x] 1.3 Implement separate bounded cleanup/observed-stage comparisons; verify unchanged, absent, partial, ambiguous, insertion/deletion/substitution, snippet expansion, full rewrite and oversize/work-budget coverage.
- [x] 1.4 Implement exact preset/app/category/corpus aggregation, subgroup support, ranking and omitted counts; verify globally frequent terms absent from daily top-N and matching intersection filters.

## 2. Source and retained-state integration

- [x] 2.1 Extend only the opted-in fixed-column reader profile and strict config; qualify supported and missing metadata with synthetic SQLite fixtures and verify numeric-only reads select no text, source bytes remain unchanged and oversized stages preserve numeric contributions.
- [x] 2.2 Integrate private unordered derivatives with complete-scan replacement, retry, late-edit, pruning and compatible-version coverage; verify restart, archived features, policy changes and zone rebuild without copied transcript strings.
- [x] 2.3 Apply opt-out before source reads or pending publication; verify disabled collection/status/export, interrupted publication, clear/reset, managed backups, numeric restore and reenablement cannot silently revive cleared text.
- [x] 2.4 Add qualified dictionary/snippet snapshot counters with availability and comparison segments; verify repeat/reset/deletion/missing-schema cases without double-counting or reading entry text.

## 3. Consumer and delivery qualification

- [x] 3.1 Exercise real opted-in collector output through shared validation and compatible Hub routes; verify three corpora, separate changes, exact presets, numeric-only compatibility, suppression and text-disabled generations.
- [x] 3.2 Update the package, owning guides and applicable CI commands; run build/type, collector, extracted-package, contract-consumer and required shared checks, retaining failures and successful receipts.
- [x] 3.3 Run native Windows synthetic source, privacy/recovery and offline-package qualification against the final source candidate; retain package hashes and explicit installed-data limits.
- [x] 3.4 Map issue acceptance to source evidence and complete spec synchronization/archive before independent review. Final reviews, hosted CI, guarded merge and tracker acceptance remain coordinator gates outside this implementation task list.
