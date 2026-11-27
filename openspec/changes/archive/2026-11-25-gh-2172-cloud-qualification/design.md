## Context

Enrollment identifies a worker connection. The Hub already checks sharing and capability eligibility for each route and checks the selected worker again before dispatch.

## Decisions

Use the common selector for both Auto and pinned cloud choices. Require an exact operation, repository revision, harness and connection match with a verified, unexpired provider workspace. Local device and installation operations are ineligible for cloud. Keep admission read-only and leave launch out of routing.

Exercise a single disposable workspace qualification with explicit compute and storage bounds, an absolute teardown deadline and exact launch and cleanup receipts. An ambiguous effect holds the qualification. Provider/account selection, durable operator reconciliation and actual service guarantees belong to the later activation.

## Risks and trade-offs

The fake demonstrates the expected request and receipt lifecycle. Real activation needs evidence of provider-side hard enforcement, acceptable hard limits, trusted workspace/worker binding, persistent claims and cleanup reconciliation, plus normal sharing and enrollment checks. The separate supervisor model budget cannot authorize cloud infrastructure.
