## 1. Collection and normalization

- [x] 1.1 Add canonical validation/resolution modules and fixture conformance checks against the unchanged #545 references.
- [x] 1.2 Implement paginated collection, independent inventory reconciliation, whole-attempt consistency and required reference closure; adapter tests cover truncation, mutation and optional failures (AC1, AC6).
- [x] 1.3 Normalize story/recommendation metadata through existing parsers and expose actionable audit findings; live audit accounts for every open issue (AC1, AC4).

## 2. Candidate and browser

- [x] 2.1 Generate complete ordinary views and deterministic composed fixture; tests prove unique placement, deep ancestry, readiness and UTC completion boundaries (AC2, AC7).
- [x] 2.2 Implement reusable renderer, bounded lists, filters, navigation, briefs and print; browser checks cover large epics, mobile, keyboard, theme, Back and clipboard fallback (AC2, AC3).
- [x] 2.3 Bind and verify release bytes, preserve last-good data and pin open clients; negative and deployment browser checks reject unsafe/mixed/unsupported input (AC4, AC6, AC8).

## 3. Integration and delivery

- [x] 3.1 Record canonical checks in development documentation and CI; run the actual generator, existing Guide and shared workflow/build/type/contract checks (AC5).
- [x] 3.2 Generate and inspect the live source candidate and inventory audit; record scope and gaps for #540, #654 and #317 (AC1–AC8).
- [x] 3.3 Complete the local acceptance evidence and synchronize/archive this specification before final review. Independent review, hosted CI, guarded merge and main-CI/tracker readback remain delivery gates held by the coordinator.

Local acceptance used Node 24 and Python 3.14. Adapter and contract conformance checks passed (108 tests); browser checks passed the 240-member large epic, recommendation states, partial history, literal text, keyboard/mobile/axe, print, retained-release and unsupported/mixed-input controls. The live source snapshot is 2026-10-02T04:33:27.660Z; the audit accounts for 410 open primary issues exactly once, with no explicit epic labels. The source candidate was checked in a local browser; hosted acceptance and publication are separate work. Development documentation lists the canonical commands. Required shared build, type, controller/package and workflow checks and the existing Guide checks passed locally.
