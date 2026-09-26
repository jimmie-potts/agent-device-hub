## 1. Hub validation

- [x] 1.1 Accept `supported: false` for the four configuration operations (TDD). Evidence: `a read-only Nanoleaf device snapshot validates with the same closed shape` and `the integration route serves a read-only device snapshot next to the Lines` in `apps/hub/tests/integration.test.mjs` failed before the change and pass after it. The existing Nanoleaf, geometry and Pixoo fixtures still pass.

## 2. Dashboard

- [x] 2.1 Show only the supported Nanoleaf configuration forms and one line for the rest (TDD). Evidence: the matrix scenario `a read-only Nanoleaf device shows mode, power, brightness and scenes without configuration edit forms` failed against the previous dashboard, which rendered the disabled forms, and passes after the change. It covers one guarded scene and brightness command, no extension write, the Lines' unchanged forms, phone width, text overlap and automated accessibility. Its last step withdraws `settings.set` from a ready Lines draft; before the fresh-read check the draft was sent, and after it nothing is sent.

## 3. Documentation and verification

- [x] 3.1 Update `apps/hub/README.md`, `apps/dashboard/README.md` and `docs/development.md`. Evidence: the text matches the behavior above.
- [x] 3.2 Run the shared build, type, contract, hub, dashboard and workflow checks, then sync this delta and archive the change on the delivery branch. Independent reviews, current-head CI, UI approval, guarded merge and merged-main readback remain SDLC gates after archive.
