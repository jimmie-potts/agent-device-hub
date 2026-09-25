## Context

See proposal.md (Why). The hub serves `GET /api/playback/v1/snapshot` and `POST /api/playback/v1/commands` for one configured source. Authorization already treats the source ID like a device grant: a credential needs the ID in `devices`, `read` for snapshots and `control` for commands. Launcher sessions are built from the controller aliases only. The hub MCP registers `hub-service` and one registration per controller alias. The dashboard polls controller snapshots every five seconds, and one-click actions go through the shared command lifecycle in `apps/dashboard/src/lifecycle.ts`.

## Goals / Non-Goals

**Goals:** let the existing browser session and machine credentials use the one configured source with the least new authority, and keep every command bound to that source.

**Non-Goals:** a second source or source selection, a playback push feed, artwork, play/resume, or any new credential kind or scope.

## Decisions

- **Browser grant.** The launch exchange adds the configured playback source ID to the session's `devices`. Scopes stay `read` and `control`, and the existing route checks decide everything else. The dashboard context adds `playback: {sourceId}` only when the caller's credential grants it, so a manual credential without the source sees no view. The alternative, a separate playback-only session, would add a second bearer for one source.
- **MCP registration.** The source becomes one more registry entry, keyed by its source ID under a `hub-playback` controller identity. It binds `<prefix>_playback_status` (read) and `<prefix>_playback_command` (control), using the same `toolPrefix` as controller aliases. Source IDs are validated to differ from every alias, so names cannot collide. The reusable package's existing per-device scope filter then handles discovery and calls without any package change. The command tool supplies the bound source ID itself, so a caller cannot redirect a command. The hub refuses commands while staged, like the HTTP route. `unsupported-control`, `source-unavailable` and `unknown-source` join the known pre-effect rejections; an uncertain receipt is reported as an error result whose receipt keeps the request ID.
- **Dashboard view.** The view is a separate navigation entry under a Music label, not a controller component, because the playback snapshot has a different shape and freshness model. It polls every two seconds to match the source's read cadence; the five-second controller poll would often show a stale badge. Playback requests use their own mutation channel in the API client, so a playback command does not cancel an in-flight monitor read. A command runs `runCommand` with a fresh snapshot read as preparation. It builds `{requestId, sourceId, action}` from the displayed source and a new random request ID. A playback receipt maps to the lifecycle's evidence: `sent` is accepted, a receiver refusal (`failed`) is a rejection with nothing changed, and `uncertain` locks.
- **Paused controls.** Owner live check, 2026-09-25 06:52 UTC: with AirPlay `PAUSED`, the receiver acknowledged `setPlayNextContent` and `setPlayPreviousContent`, the phone changed track forward and back without playing, and four reads over eight seconds still reported the old title, paused. The Sony module declares `next` and `previous` while paused. The dashboard and the MCP status description warn that some sources, including this one, may not refresh the title while paused.

## Risks / Trade-offs

- [The title lags after a paused skip] → a visible note while paused, and the MCP description says the same. The status stays accurate.
- [A browser session can now control the receiver] → this is the same owner-only launcher boundary as the device aliases. The grant covers only the configured source and only through the existing route checks.
- [A two-second poll adds loopback reads] → one small GET per open dashboard, served from the hub's cached observation without contacting the receiver.

## Migration Plan

No data migration. Installing the merged hub gives new launcher sessions the playback grant. A Codex MCP credential needs `read` and `control` with the source ID in `devices`; the installed `playback-control` credential already has them. Rollback is reinstalling the previous hub archive.
