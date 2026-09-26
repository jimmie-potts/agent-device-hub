## 1. Tidbyt and device-control policy

- [x] 1.1 Demonstrate title selection and versioned feed failures before the fix: focused status and feed tests failed on the missing title and version query.
- [x] 1.2 Implement selection, feed opt-in and ADR 0005 policy; preserve legacy consumers with the default-feed and LIFX tests.
- [x] 1.3 Add deterministic title and neutral preview fixtures; validate the snapshot, emitted frame and independent Pillow decode.
- [x] 1.4 Run build/typecheck, Tidbyt, agent-status, LIFX, controller-contract TypeScript/Python/package and workflow checks.

## Remaining issue work and delivery gates

This completed source change covers only Tidbyt and ADR 0005. The moment representation, title fixture and ADR 0006 require the #335 owner's handoff and remain pending in #426. The divoom #94 search policy is outside this PR. No remaining issue criterion is marked complete here.

Current-candidate Tidbyt UI approval, independent Standards and Specification reviews, hosted CI and guarded merge remain PR gates. No installation or device acceptance is claimed.
