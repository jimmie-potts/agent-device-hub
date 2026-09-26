## 1. Route and validation

- [x] 1.1 Add `validateIntegrationGeometry` and check it against the owner's copied fixtures (TDD). Evidence: `Nanoleaf geometry fixtures from the owning contract validate exactly` classifies all 27 cases; before the implementation the test file failed on the missing export.
- [x] 1.2 Add `ControllerClient.integrationGeometry()` and the hub route. Evidence: `Nanoleaf geometry passes through a read-only sibling route with the owner's credential kept private` covers the Lines, the Panels, a device without a layout, an older owner, incompatible responses, other kinds, a query string and writes.

## 2. Documentation and verification

- [x] 2.1 Update `apps/hub/README.md` routes and compatibility rows. Evidence: the rows match the route's behavior.
- [x] 2.2 Run the shared build, type, hub, package, contract and workflow checks; synchronize this delta and archive the change on the delivery branch. Independent reviews, current-head CI, guarded merge and merged-main readback remain SDLC gates after archive.
