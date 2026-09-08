# Guide maintenance history

## 2026-09-08: repository adoption candidate

Repository: agent-device-hub. Move the existing three-project guide, generator,
diagram definitions and evidence inputs into `docs/work-guide`. Add the SDLC
maintenance procedure and PR completion check. The existing backlog, product
history, architecture and acceptance claims are unchanged. This entry records a
candidate; merge and independent review are pending. Validation is recorded in
the adoption PR and final delivery report.

Independent Standards and Specification reviews identified a build failure when
new history heads differed from pinned architecture sources. Removed that
coupling and the unconditional current-head claim. The offline regression test
failed before the fix and passed after it. Product facts and snapshot dates
remain unchanged. Companion PRs: Hub #72, Nanoleaf #51, Pixoo #51.
