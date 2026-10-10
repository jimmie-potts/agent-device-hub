## 1. Compatible contract

- [x] 1.1 Prove new playback artwork validation fails before implementation; add 2.1 schema, types and synthetic fixtures while retaining 2.0, verified by event tests and byte/shape boundary cases.
- [x] 1.2 Verify old and new records through SDK sync/live and text-only runtime, Pixoo and Tidbyt consumers; ensure artwork-only revisions preserve track triggers and text behavior.

## 2. Independent acquisition

- [x] 2.1 Prove Sony candidate retention and bounded acquisition fail before implementation; add private URL handling, same-origin fetch and worker normalization, verified with synthetic JPEG, malformed image, redirect, deadline, byte and pixel boundaries.
- [x] 2.2 Prove delayed-result association fails before implementation; integrate current generation and candidate invalidation, deduplication, bounded retries and lifecycle cancellation, verified by source handoff, late A after B, paused lag, freshness, stop and restart tests.
- [x] 2.3 Document producer limits and privacy behavior in its owning guide; verify all new tests are included in existing registered check commands and CI.

## 3. Integrated source acceptance

- [x] 3.1 Run required build, type, lint, event and retained Python fixtures, SDK, playback, runtime/scenario, affected consumer and workflow checks, retaining raw synthetic evidence.
- [x] 3.2 Validate and synchronize affected specifications; verify the specification inventory and workflow checks before the coordinator archives this exact change for final review.
