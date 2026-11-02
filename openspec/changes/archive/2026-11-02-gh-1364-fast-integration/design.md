## Context

The existing selector maps paths to broad test groups and the preflight independently recomputes that selection. Core checks always build, typecheck and lint. App verification and the full serial runtime catalog are separate jobs. #1363 supplies a reusable full qualification workflow and immutable ARM64 image evidence; #1321 supplies the isolated Linux runner. See proposal.md for motivation.

## Goals / Non-Goals

Use the existing selector, workflows, reviews and preflight. Add no scheduler or deployment authority. Keep task resources independent and source/qualification/installation outcomes separate.

## Decisions

- A focused mode retains existing affected core test groups and omits only broad App/runtime verification jobs. Start with an exact list of existing dashboard/frontend CSS assets. All executable frontend code and newly introduced paths stay conservative. Backend and unknown changes retain existing conservative coverage. This is a smaller auditable set than attempting per-test dependency inference.
- The hosted selection notice includes job choices, and the preflight checks them as well as groups. This prevents an identical group list concealing omitted jobs.
- The existing reduced Markdown-only route remains available. Core build, typecheck, lint, independent review and workflow/documentation checks still apply. Omitted product suites are not reported as passed, and selection readback verifies their omission. Designated policy paths retain full coverage.
- Draft PRs skip expensive jobs. Ready-for-review, reopened and synchronize events run admission. Main pushes enqueue the #1363 qualification workflow; remove old direct main triggers only after its hosted evidence succeeds.
- Keep branch PR requirements, forbid force push/admin bypass and retain the expected-head merge guard. Turn off strict up-to-date checks only after source review and replacement qualification are accepted. Refresh review of the actual comparison when needed; an unrelated merge does not itself require a new build.
- Deployment ownership applies to the selected live operation. Disposable tasks use private synthetic resources and supported CLI configuration. Existing client evidence is reused; no personal profile or provider session is implicitly authorized.
- Browser proof files are mutable task resources. The MicroDuck and Reachy journeys allocate a unique private directory for each invocation under the selected `DASHBOARD_RECEIPTS` parent or the system temporary directory. The existing filename stays inside that owned directory. Output allocation fails before starting a world if its parent cannot be used. State and browser cleanup leave retained proof intact. A shared fixed filename and a caller-supplied parent alone do not provide isolation. Writers already using `DASHBOARD_RECEIPTS` retain their documented unique per-task parent; this change fixes the two confirmed host-path bypasses rather than claiming every writer allocates a child automatically. The vendor-only `/proof` path belongs to its separately owned isolated container. Verify a fixed-name collision only inside an owned namespace, then run two identical MicroDuck browser journeys concurrently and the affected Reachy journey, confirming separate outputs plus unchanged unrelated files.

## Risks / Trade-offs

A UI change can cause an integration regression. Focused unit/consumer checks and affected independent disposable acceptance protect admission; complete packaged-image qualification protects installation. Unknown or backend paths retain broad checks. Policy changes use full checks and independent review before activation.

## Migration Plan

Implement and review under the old rules. Merge #1321 and #1363, observe successful full qualification, then integrate this change under the old full policy. Read back all applicable merged checks, enable main qualification and read back effective branch rules. Run the combined epic exercise before claiming acceptance. If activation fails, retain the prior gates and report the incomplete step. No runtime data migration is involved.
