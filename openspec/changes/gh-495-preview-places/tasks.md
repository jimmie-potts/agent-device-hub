## 1. Hub configuration and context

- [x] 1.1 Validate optional `placeLinks` before startup and accept the key in `cli.js` configuration. Verified by a focused red/green Hub test (`apps/hub/tests/dashboard.test.mjs`): unsafe URLs, the B.U.N.N.Y. id, too many entries and a non-object all refuse with `invalid-place-links`. The composition tests start the real `cli.js serve` with the field.
- [x] 1.2 Return the configured links in the dashboard context only when configured. Verified by a Hub test: an unconfigured context has no `places` field, and links are normalized.

## 2. Dashboard Places

- [x] 2.1 Link each configured Local place to its URL and omit other Local places except B.U.N.N.Y. Verified by a focused red/green browser scenario (`apps/dashboard/tests/preview-places.mjs`): a paired Wall link, a Hub-only preview without Wall, unchanged Public links, axe clean and no controller command.
- [x] 2.2 Configure the Hub verification runs: the standalone scenarios empty, `integrated` with the paired wall run. Include Places in the adapter's installed-port link check. Verified by `steps.test.mjs`: `control-installed-links` still fails and names the Places link. `compose.test.mjs` verifies that the integrated context points Wall at the paired run.

## 3. Evidence

- [x] 3.1 Capture before and after screenshots of the preview Places and ask the owner to approve the current UI candidate. The owner approved it at 3eeddb748315a1fb61ae0d76db9f1cc5fe73e872, recorded on PR #556 (https://github.com/jimmie-potts/agent-device-hub/pull/556#issuecomment-5857961024).
- [x] 3.2 Run the dashboard, Hub, Hub verification and shared checks. All exit 0 locally, and CI is green on 2b64b9a and 385da7b.
- [ ] 3.3 Validate, synchronize and archive this change with the consumer pin commit, and verify the spec inventory.
