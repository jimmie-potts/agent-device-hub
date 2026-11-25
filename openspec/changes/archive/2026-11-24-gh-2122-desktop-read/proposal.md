## Why

The explicit Claude read receipt works only in Claude Code 2.1.292 in a terminal ([#2122](https://github.com/jimmie-potts/agent-device-hub/issues/2122)). The owner uses the Claude desktop app, whose bundled Claude Code is newer, so `/bunny-read` there shows "Read receipts are unavailable here." and nothing is sent. The restriction is ours: the plugin and helper pin the version and the `terminal` surface. The owner decided on #2122 to accept the `desktop` surface as well as `terminal`, drop the version pin, and keep `vscode` and `mobile` refused until someone checks them on a real client.

## What Changes

- The plugin's `command.run` and `ui.render`, and the helper's input schema, accept `terminal` and `desktop` and refuse `vscode` and `mobile` with the existing unavailable text and code.
- No Claude Code version is required or compared. The plugin passes the version for information when it has a bounded value and leaves it out otherwise.
- `CLAUDE_RECEIPT_FEED` becomes the literal `claude-terminal-read-2.1.292`, documented as a persisted enrollment ID, so `receiptSource` and enrolled credentials stay valid. `CLAUDE_TERMINAL_VERSION` is removed; only the helper's re-export and tests used it. `CLAUDE_READ_SURFACES` names the accepted surfaces.
- The release ships a local plugin marketplace (`apps/runtime/plugins/.claude-plugin/marketplace.json`, name `bunny`) so the plugin loads through Claude settings (`extraKnownMarketplaces`, `enabledPlugins`) instead of `--plugin-dir`. The plugin manifest's description and version (0.2.0) change.
- `apps/runtime/READ-RECEIPTS.md` documents settings-based loading, the helper paths in the settings `env` block, and the two installed-acceptance unknowns. `docs/development.md` and the read-receipt research note point to the current surfaces.
- The session, prompt, turn, generation, notice and `viewRevision` binding, explicit-press-only commits, no polling and no retry are unchanged.

**No design.md.** The change widens one closed enum, makes one informational field optional and replaces a derived constant with its own value. No contract, table, record, message, timing, credential or privacy behavior changes.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `bunny-runtime`: "Qualified explicit read receipts commit against the displayed target" (Claude terminal and desktop surfaces at any version under the persisted feed; `vscode` and `mobile` refused).

## Impact

`apps/runtime/src/read-receipts` (`qualification.ts`, `helper.ts`), the `claude-read` plugin and its new marketplace manifest, the read-receipt tests and the dashboard read-receipt browser journey, `apps/runtime/READ-RECEIPTS.md`, `docs/development.md` and `docs/research/explicit-read-receipts.md`. The read-receipt contract, the core's commit path, the gateway's admission and every credential are unchanged; no new token or scope. Host settings and hooks change only on the host under the owner's install-time authorization. Delivery is reviewed integrated source; the Mac install and the real-use check in the desktop app run under #1869.
