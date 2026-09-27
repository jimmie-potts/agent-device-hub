## 1. Hub configuration and context

- [ ] 1.1 Validate optional `placeLinks` before startup and accept the key in `cli.js` configuration. Verify with a focused red/green Hub test: unsafe URLs, the B.U.N.N.Y. id, too many entries and a non-object all refuse with `invalid-place-links`.
- [ ] 1.2 Return the configured links in the dashboard context only when configured. Verify with a Hub test that an unconfigured context has no `places` field and that no credential appears.

## 2. Dashboard Places

- [ ] 2.1 Link each configured Local place to its URL and omit other Local places except B.U.N.N.Y. Verify with a focused red/green browser scenario: paired Wall link, Hub-only preview without Wall, unchanged Public links, and no controller command.
- [ ] 2.2 Configure the Hub verification runs: the standalone scenarios empty, `integrated` with the paired wall run. Include Places in the adapter's installed-port link check, and verify that its `control-installed-links` step still fails.

## 3. Evidence

- [ ] 3.1 Capture before and after screenshots of the preview Places and record the owner's explicit approval of the current UI candidate in the PR.
- [ ] 3.2 Run the dashboard, Hub, Hub verification and shared checks. Then validate, synchronize and archive this change and verify the spec inventory.
