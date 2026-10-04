## 1. Reader and contract (red, then green)

- [x] 1.1 Failing tests for the session index reader: newest entry wins, ties, malformed and invalid lines, missing index and home, size bound, cache refresh; implement `CodexThreadNames` in `src/windows/client-files.ts` (evidence: `windows-client-files.test.mjs`).
- [x] 1.2 Define OS adapter interface version 2 with `codexSelectedThread`; failing adapter tests for Codex-name precedence, Hub fallback, `codex-title-missing` and no title text in results; implement it in `src/windows/adapter.ts` and the unsupported adapter (evidence: `windows-adapter.test.mjs`, `os-adapter.test.mjs`).
- [x] 1.3 Failing router tests for verification by Codex name without a Hub title, precedence over a stale Hub title and fail-closed `title-missing`; update `src/routing/router.ts` and the fake adapter (evidence: `routing-router.test.mjs`).

## 2. Documentation and validation

- [x] 2.1 Update the bridge README, `UIA-NOTES.md`, the native check and the routing design in `docs/chompi-controller-qualification.md`.
- [x] 2.2 Run build, typecheck, the bridge suite and the workflow checks; record results in the PR.
- [x] 2.3 Synchronize the specs and archive this change before final review.
