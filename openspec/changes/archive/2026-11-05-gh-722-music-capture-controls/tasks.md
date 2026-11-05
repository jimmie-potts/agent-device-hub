## 1. Qualified input projection

- [x] 1.1 Add failing unit scenarios for request/receipt clock bounds, latency and jumps, identity/sequence admission, expiry and scoped teardown; demonstrate failures before implementation.
- [x] 1.2 Implement the Audio-scoped state/features consumer on the existing connection and pass the focused tests without a new participant, protocol or state polling path.

## 2. Explicit capture controls

- [x] 2.1 Add the Audio-only card using existing tracked attempts, current revision and independent Stop admission; verify commands and truthful state with the disposable browser journey.
- [x] 2.2 Verify no command on load/reload/reconnect, pending and uncertain outcomes, read-only access, stale meters, keyboard and light/dark desktop/phone accessibility; retain private synthetic screenshots for visual review.

## 3. Source acceptance

- [x] 3.1 Document measurement-only behavior and existing check entry coverage, then verify instructions and run build, typecheck, lint, dashboard unit/browser and direct-consumer checks.
- [x] 3.2 Complete workflow checks, synchronize all added dashboard requirements and verify delta/main equivalence before archive and frozen independent review.

## Source evidence

The focused unit work demonstrated failures for clock/projection behavior,
conservative expiry and a retained sync completion after restart before the
corresponding fixes. The final focused suite passes. The real disposable
browser journey passes with numeric producer data, including delayed clock
qualification, a lost Start reply and reload without replay, independent Stop,
read-only refusal, replacement generations and endpoint loss. Keyboard,
light/dark desktop and 320/390 px accessibility checks pass; screenshots were
inspected privately. The local hosted-smoke command and full dashboard browser suite pass. No PR
CI has run yet.

Build, typecheck, JavaScript lint, 173 dashboard tests, 238 event tests,
27 producer tests, 410 controller-contract tests, 140 lifecycle tests and their
Python/package compatibility checks pass. The browser export bundle test
excludes the server registry and preserves existing constant values.

The broad macOS runtime run reports 1,012 passed, seven skipped and six counted
failures: unchanged checkout/file redaction-count assertions and Linux-only
flock cases. The SDK run reports 397 passed and the existing oversized-body
EPIPE failure. The redaction and EPIPE failures also occur in the earlier capture work's
private logs; flock is absent on this Mac. This increment changes none of
their source or assertions. They remain
explicit qualification limits and are not repaired or waived here. Source
review and hosted checks remain delivery gates. No installed source, media,
permission, lighting or device acceptance was performed.
