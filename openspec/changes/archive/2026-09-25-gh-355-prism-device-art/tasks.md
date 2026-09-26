## 1. Shared art

- [x] 1.1 Port `prism.js` to `apps/dashboard/src/art/prism.ts` with provenance in `apps/dashboard/src/art/README.md`; verify with `npm run typecheck:dashboard` and a unit test that `validate` accepts the wall map's layout rules and rejects the documented invalid layouts.
- [x] 1.2 Add the hub adapter (`art/nanoleaf.ts`): geometry to Prism layout, Panels polygons, snapshot to presentation, schematic strip model. Verify with unit tests (the adapter and its tests were written together; a mutation of the signature-zone rule fails two of the seven tests, restored before commit) covering project colors by signature, the no-status base, pending marks, the null-layout strip and the older-owner strip.
- [x] 1.3 Add the Panels triangle renderer and the React host (`art/NanoleafArt.tsx`) with mount, update and destroy; verify in the browser harness that status and activity inputs color and pulse elements and reduced motion stops the flow.

## 2. Pages, tokens and tests

- [x] 2.1 Show the art on the Nanoleaf component pages, read the geometry once per component, and move `--wall-*`/`--chip-*` into the skin; verify with `npm run test:dashboard` (style token checks) and `npm run typecheck:dashboard`.
- [x] 2.2 Extend the fake fixture with geometry (15 Lines and 12 connectors, 18 triangles, no layout, older owner) and add `apps/dashboard/tests/art.mjs` to `test:dashboard:browser`; verify Lines, Panels, fallback, stale, reads-only and axe at 1280 px and 390 px.
- [x] 2.3 Update `apps/dashboard/README.md`, `docs/development.md` and the style guide's token ownership note; verify the documented commands match the scripts.

## 3. Delivery

- [x] 3.1 Run the shared build, type, dashboard, hub, contract and workflow checks; synchronize this delta and archive the change on the delivery branch. Independent reviews, current-head CI, the owner's UI approval, guarded merge and merged-main readback remain SDLC gates after archive.

Evidence at the candidate: `npm run typecheck`, `npm run test:dashboard` (43 pass), `node apps/dashboard/tests/art.mjs` (7 checks), `npm run test:dashboard:browser` suites, `npm run test:hub:built` (126 pass), `npm run test:hub:package:built`, `npm run test:contracts`, `npm run check:workflow` and `npm run test:workflow` (15 pass) all exit 0 on Node 24.21.0. The owner's side-by-side UI approval is pending on the PR.
