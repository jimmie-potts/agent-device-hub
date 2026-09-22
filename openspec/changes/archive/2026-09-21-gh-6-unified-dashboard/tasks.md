## 1. Protected browser boundary

- [x] 1.1 Add dashboard build/type/browser commands to development and CI; verify installation and a focused failing protected-context test before implementation.
- [x] 1.2 Serve fixed static assets and scoped context with validated editor links; verify unauthenticated, cross-origin, read-only and device-scope cases and packaged assets.

## 2. Observation and controls

- [x] 2.1 Add activity/source views, explicit labels and notice acknowledgment; browser checks cover independent evidence, attributable children, empty state and inspection without writes.
- [x] 2.2 Add reusable component navigation/status/settings with typed Nanoleaf/Pixoo integration controls; verify capabilities, permissions, modes, mappings, filters, pending and unknown observations with two owning-contract fixtures and a third synthetic component.
- [x] 2.3 Add snapshot/feed refresh, bounded reconnect and draft preservation; demonstrate stale result rejection, expired cursors, concurrent client conflicts, uncertain commands, focus preservation and slow-device isolation.

## 3. Qualification and delivery

- [x] 3.1 Run synthetic browser scenarios at desktop/mobile widths with keyboard, contrast and reduced-motion checks; retain latency measurements for Hub #30 and present the exact UI candidate for human approval.
- [x] 3.2 Update dashboard/architecture and guide inputs, regenerate outputs and verify guide checks, shared consumers and full configured CI.
- [x] 3.3 Prepare the archive handoff after implementation acceptance; verify synchronized requirements, recorded human UI approval and acceptance evidence in PR #127.

## Mandatory delivery gates after implementation

The original task 3.3 mixed implementation acceptance with archive, final review
and merge. The SDLC requires archive before final review, so those later gates
remain delivery obligations rather than prerequisites for archiving this task
list. Archive the synchronized change, obtain independent Standards and
Specification review of the committed candidate, require every configured
current-head CI job, perform the guarded merge, and verify all merged-main jobs
before issue closure. Reconcile guide history and status afterward. PR #127
owns revision-specific approval, review, CI and completion receipts. None of
these later gates is declared complete by this implementation checklist.
