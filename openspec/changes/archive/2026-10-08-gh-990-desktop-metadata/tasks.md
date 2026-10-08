## 1. Title and contract

- [x] 1.1 Add metadata-observed and queued title updates; prove title-only changes preserve lifecycle state with a red/green owner regression and lifecycle schema checks.

## 2. Reader and admission

- [x] 2.1 Port bounded titles and filename archives through reader IPC; prove synthetic source reads and module publications with focused tests.
- [x] 2.2 Integrate ephemeral archive admission and trusted metadata intake; prove late root/child hooks, source isolation, unarchive/unavailable/expiry and title independence in core tests.

## 3. Delivery evidence

- [x] 3.1 Extend codex-desktop-read scenario and provenance docs; verify the affected scenario and required direct consumer/package/build/type/lint/workflow checks.
- [x] 3.2 Observe the bounded disposable Acceptance run and retain its evidence, coordinated by root.
- [x] 3.3 Synchronize both affected specs after successful current lookups and completed acceptance evidence, ready for archival.

Independent Standards and Specification reviews inspect the committed candidate after synchronization and archival. They remain delivery gates owned by the coordinator.

Independent disposable Acceptance at `bb81bb79` passed `codex-desktop-read` in run `runtime-20261008T135909Z-e4c222`: 30 scenario steps and independent session observations passed; cleanup completed. This is synthetic source evidence, with installation deferred to #840.
