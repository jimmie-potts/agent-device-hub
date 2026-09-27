## 1. Hub configuration and context

- [x] 1.1 Validate optional `placeLinks` before startup and accept the key in `cli.js` configuration. Verified by a focused red/green Hub test (`apps/hub/tests/dashboard.test.mjs`): unsafe URLs, the B.U.N.N.Y. id, too many entries and a non-object all refuse with `invalid-place-links`. The composition tests start the real `cli.js serve` with the field.
- [x] 1.2 Return the configured links in the dashboard context only when configured. Verified by a Hub test: an unconfigured context has no `places` field, and links are normalized.

## 2. Dashboard Places

- [x] 2.1 Link each configured Local place to its URL and omit other Local places except B.U.N.N.Y. Verified by a focused red/green browser scenario (`apps/dashboard/tests/preview-places.mjs`): a paired Wall link, a Hub-only preview without Wall, unchanged Public links, axe clean and no controller command.
- [x] 2.2 Configure the Hub verification runs: the standalone scenarios empty, `integrated` with the paired wall run. Include Places in the adapter's installed-port link check. Verified by `steps.test.mjs`: `control-installed-links` still fails and names the Places link. `compose.test.mjs` verifies that the integrated context points Wall at the paired run.

## 3. Evidence

- [x] 3.1 Capture before and after screenshots of the preview Places and ask the owner to approve the current UI candidate. The approval itself is recorded in the PR as the merge gate.
- [x] 3.2 Run the dashboard, Hub, Hub verification and shared checks (all exit 0 locally; CI green on 2b64b9a). Then validate, synchronize and archive this change and verify the spec inventory.
