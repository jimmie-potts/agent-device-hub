## 1. Surfaces and version

- [x] 1.1 Red: plugin, helper and core tests for the `desktop` surface, an unpinned (2.1.325, 2026.11.25) or absent version, `vscode` and `mobile` refused, and the literal feed and source. Evidence: before the change `claude-read-plugin.test.js` fails the desktop/unpinned and unexpected-version tests and `read-helper.test.js` fails the desktop/unpinned test; the refusal and literal-feed guards pass as protections.
- [x] 1.2 Accept `terminal` and `desktop` in the plugin and the helper schema, make the version optional information, and make `CLAUDE_RECEIPT_FEED` a literal. Evidence: the same tests pass. Negative controls: adding `vscode` and `mobile` to the plugin's surfaces fails two plugin tests; widening the helper's surface to any string fails its refusal test; requiring the version again fails its desktop test; changing the feed literal fails the core literal test.

## 2. Loading and documentation

- [x] 2.1 Ship a `bunny` local marketplace listing `bunny-read`. Evidence: the plugin test checks it against the plugin manifest.
- [x] 2.2 Update `apps/runtime/READ-RECEIPTS.md`, `plugin.json`, `docs/development.md` and the research note. Evidence: readback.
- [x] 2.3 Synchronize `bunny-runtime` and archive this change. Evidence: `npm run check:workflow` passes.
