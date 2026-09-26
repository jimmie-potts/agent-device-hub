## Why

[Hub #276](https://github.com/jimmie-potts/agent-device-hub/issues/276): the owner wants to open B.U.N.N.Y. from one bookmark and land on the dashboard signed in, with no token, code or launcher step, and stay signed in across a reload or a second tab. Today the page needs the `open` launcher ([#179](https://github.com/jimmie-potts/agent-device-hub/issues/179)) or a hand-made token, a reload shows the login page again, and `http://localhost:8788/` is refused by the Host check.

The owner chose Option 1 on 2026-09-25: an opt-in trusted-loopback sign-in. Option 2, a sticky cookie on the launcher session, was rejected.

## What Changes

- A new optional private configuration field, `browserAccess: "trusted-loopback"`, off by default. Any other value is an invalid configuration.
- With the field set, the hub serves `POST /api/dashboard/v1/session`. It issues the same bounded browser session as the launcher: `read` and `control` on configured controller aliases and the playback source, no `ingest` or `admin`, no MCP, 8-hour expiry, 16-session cap and the existing retirement path. The route requires the exact Host, a matching Origin, `Sec-Fetch-Site` absent or `same-origin`, `X-Pixoo-Request: 1` and an empty JSON object body. Without the field it answers 404 and issues nothing.
- The hub accepts `localhost:<port>` as well as `127.0.0.1:<port>` as the Host of the page, its assets and its API. The Origin, when present, must name the same host as the Host header. MCP keeps its numeric-loopback origin.
- The dashboard asks for a session on load when the page has no launch code. On success it opens the dashboard directly; a reload or new tab asks again. There is no cookie or storage. `pagehide` logs the page's session out, and a page restored from the back-forward cache signs in again. A refused route (404) shows today's login page unchanged. Any other failure shows the same page with an alert. After Disconnect, or when the session has ended, the page offers one explicit sign-in button.
- The launcher and the manual-token form keep working, with or without the field.
- The hub is bumped to 0.3.9 because the bundled dashboard and routes change.

Assurance lost, stated plainly and accepted by the owner in #276: with the field on, any program on the PC that can send a same-origin-looking loopback request with the custom header gets the same read and control a launcher session has. This matches the Nanoleaf wall map on port 8765. Reassess before any LAN, phone or second-operator exposure.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `standalone-hub-host`: the browser handoff requirement gains the trusted-loopback issuing path, and the Host check accepts the `localhost` alias.
- `unified-dashboard`: the local owner launch requirement gains sign-in on load, reload and second-tab behavior, and the failure and recovery paths.

## Impact

Changes `apps/hub/src/server.ts`, `apps/hub/src/cli.ts`, `apps/dashboard/src/main.tsx` and `client.ts`, with hub unit tests, the dashboard browser fixture and a new browser check. Updates the hub README, `apps/hub/SETUP.md`, the dashboard README and `docs/development.md`. No controller contract, MCP package, agent-state or device change. The installed `host.json` and hub package are updated only by a named owner on explicit request. The login page and shell change, so the candidate needs the owner's UI approval before merge.
