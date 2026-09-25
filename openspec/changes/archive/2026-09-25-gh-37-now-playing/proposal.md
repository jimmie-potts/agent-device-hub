## Why

[Hub #37](https://github.com/jimmie-potts/agent-device-hub/issues/37) puts the shared playback from [#175](https://github.com/jimmie-potts/agent-device-hub/issues/175) in front of the owner. The hub already reads the Sony HT-A9 and accepts pause, next and previous, but B.U.N.N.Y. launcher sessions have no playback grant, the dashboard has no now-playing view, and Codex has no playback tools. The Sony source also hides next and previous while paused. The owner's live check on 2026-09-25 showed that both calls change the phone's track while paused without resuming, although the receiver keeps reporting the old title.

## What Changes

- Launcher-issued browser sessions also get `read` and `control` on the configured playback source ID. The dashboard context names the playback source only for a caller whose credential grants it.
- B.U.N.N.Y. gets a text-only now-playing view that polls the playback snapshot. It shows buttons only for controls the source currently declares, and only to a control-scoped caller while the source is available. It names why other controls are missing and binds each command to the displayed source.
- The hub MCP gets a read-scope playback status tool and a control-scope playback command tool bound to the configured source ID. They are listed only for credentials that grant that source.
- The Sony source declares `next` and `previous` while AirPlay is paused. It still declares `pause` only while playing, and never `play`.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `hub-playback`: Sony paused-state controls.
- `standalone-hub-host`: the browser session grant includes the configured playback source.
- `standalone-hub-mcp`: source-bound playback tools.
- `unified-dashboard`: the now-playing view and its controls.

## Impact

Standalone hub source (server, MCP registration, Sony source), the dashboard, their tests, the hub and dashboard guides, `docs/development.md` and the hub package version. There are no shared package, controller contract or CI workflow changes; the existing Hub, MCP and Dashboard jobs run the new cases. Source delivery installs nothing and contacts no receiver. Installed browser and Codex MCP acceptance are recorded on the issue after merge. Artwork (#229), play/resume (#242), source selection and an SSE playback feed stay out of scope.
