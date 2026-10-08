# Design

## Decision

Each current storage consumer calls the SDK's `fullDisk(error)` at its existing classification seam. Core startup and transaction paths continue to set the same `full` failure state; modules continue to translate the result to their existing `capacity` outcome. Existing `SdkError` checks remain before helper classification. Playback keeps `SQLITE_BUSY` and `SQLITE_LOCKED` mapped to `unavailable`, and core keeps its separate lease `SQLITE_BUSY` retry.

## Boundaries

- Ownership and timing do not change: the core and each module retain their existing private database and transaction boundaries.
- No schema, migration, persistence format, or adapter change is introduced.
- No personal data, diagnostic fields, credentials, or sharing behavior changes.
- Recovery, severity, deduplication, admission and side-effect ordering remain as specified by current requirements.
- Classification is local storage only; network and cloud capacity are outside this change.

## Evidence and validation

Consumer tests inject a cause-wrapped `ENOSPC` at the real classification seam. Negative controls restore each former local predicate and must fail the corresponding test. Focused suites, shared build/type/lint/contract/workflow gates and strict OpenSpec validation run before review. Host-dependent acceptance remains separately gated.
