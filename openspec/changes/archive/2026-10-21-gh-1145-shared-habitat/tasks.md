## 1. Existing behavior and route

- [x] 1.1 Add a failing Habitat route scenario, then implement the normal shell destination and verify route/navigation tests.
- [x] 1.2 Port the reviewed allocation, renderer factories and art with provenance; verify ten-slot, geometry/routing and byte-preservation tests.

## 2. Shared dashboard and preferences

- [x] 2.1 Mount the scoped renderer from the existing dashboard session copy and verify one connection, state precedence, swaps, uncertainty and unmount cleanup in browser tests.
- [x] 2.2 Add bounded local preference export/import, backup and rollback; verify valid, invalid, oversized, storage-failed and unmounted cases without upload.
- [x] 2.3 Serve exactly the named artwork, adopt semantic control styles and ambient-motion rules; verify served-file, visibility/reduced-motion, fallback and desktop/phone accessibility tests.

## 3. Source qualification

- [x] 3.1 Run local build/type/lint/contract/package/workflow/dashboard checks, retain the route negative control and synthetic browser/accessibility evidence, and verify the unchanged artwork bytes.
- [x] 3.2 Reconcile navigation/style/owning guides and prepare the complete delta for main-spec synchronization and archival before final independent review.

Local evidence covers 27 habitat unit/geometry/art tests, 105 dashboard unit tests, the full dashboard browser suite and hosted smoke entry, 758 runtime unit tests, 410 controller contract tests, Python/package conformance, strict type/lint checks and 226 workflow tests. The pre-implementation Habitat route test failed as expected and passed after implementation. Evidence is private; publication uses synthetic summaries only.

Independent review, exact-head CI, guarded merge, merged-main CI, qualified installation and tracker reconciliation remain delivery gates owned by issue #1145. Checking these source tasks does not claim those later gates or installed acceptance.
