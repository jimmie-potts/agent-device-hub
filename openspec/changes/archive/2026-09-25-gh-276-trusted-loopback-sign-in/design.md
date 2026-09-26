## Context

The hub listens on `127.0.0.1` only. Every API request passes an exact Host check against `127.0.0.1:<port>`, an Origin check when an Origin is sent, a `Sec-Fetch-Site` rule, and `X-Pixoo-Request: 1` on writes. A browser session comes from `POST /api/dashboard/v1/launch`, which exchanges a 30-second code from the owner-only `bunny-launch.sock`. The resulting bearer lives in page memory. Browser sessions are capped at 16, expire after 8 hours and retire through `retireBrowser`. MCP authenticates configured credentials only.

This change touches credentials and authorization, so the acceptance examples below are fixed before implementation.

## Goals / Non-Goals

**Goals:** one bookmark opens a signed-in dashboard. A reload or second tab stays signed in. `localhost` works. Behavior without the option is unchanged.

**Non-Goals:** LAN or phone access, remote owner sign-in (#203), cookies or browser storage, a Windows launcher shortcut, removing the manual-token form, automatic renewal of a session that has ended.

## Decisions

### Opt-in route that reuses the launcher's session

`browserAccess` accepts only `"trusted-loopback"`. With it, `POST /api/dashboard/v1/session` calls the same session issuer as the launch exchange. Both paths share the scopes, device list, expiry, cap and retirement, so they cannot drift. Without the field the route answers 404, as MCP does when it is off, and checks nothing else.

The route applies the launch route's rules: the Host is an allowed loopback authority, an Origin is required and must match that Host, `Sec-Fetch-Site` is absent or `same-origin`, `X-Pixoo-Request` is `1`, and the body is exactly `{}` as `application/json`. A cross-site page cannot send the custom header or JSON content type without a preflight, and the hub answers no preflight. A rebinding page carries its own name in Host and is refused.

Alternatives considered: a cookie session (rejected by the owner as Option 2), and a flag embedded in `index.html` (the page is a static asset, and one request answers both "is the option on" and "sign me in").

### `localhost` alias

The allowed Host values are `127.0.0.1:<port>` and `localhost:<port>`. The expected Origin is built from the request's own Host, so a `localhost` page cannot use a `127.0.0.1` Origin or the reverse. Browsers resolve `localhost` to loopback themselves, so an attacker cannot rebind it. MCP, the launcher URL and `editorLinks` stay numeric loopback.

### Page lifecycle without storage

On load without a launch fragment, the page shows "Connecting to the local Hub…" and posts to the session route.

- 200 with a well-formed token: the dashboard opens.
- 404: the page shows today's login page unchanged.
- Any other response or a network failure: the same login page with an alert. The launcher and token form stay available.

In a trusted session, `pagehide` sends the logout with `keepalive`, so reloads do not pile up sessions against the cap of 16. A page restored from the back-forward cache (`pageshow` with `persisted`) signs in again. After Disconnect, the page shows one explicit "Sign in" button. If the dashboard reports `unauthenticated` in a trusted session, its alert offers "Sign in again". Nothing signs in again without a page load or a click, so a refused route cannot loop.

Launcher and manual-token sessions keep today's behavior, with no `pagehide` logout.

## Acceptance examples

1. Option on, fresh browser context opens `/`: the dashboard shows "Control enabled" without a login form. A reload shows it again, and the hub holds one browser session for that page afterwards.
2. Option on, a second tab: both tabs work, each with its own session.
3. Option on, `http://localhost:<port>/`: the dashboard opens signed in.
4. Option off, fresh context: the login page with the launcher text and token form, exactly as before, and the session route answers 404 with no session.
5. Session route with a foreign Host, a foreign or mismatched Origin, no Origin, a cross-site `Sec-Fetch-Site`, no `X-Pixoo-Request`, or a body other than `{}`: refused and no session issued.
6. A trusted session cannot ingest, quiesce or authenticate MCP. It is capped with launcher sessions at 16, the oldest is evicted, and logout, expiry, credential replacement and shutdown retire it like a launcher session.
7. Option on, the route fails with 503: the login page shows an alert, the launcher text and the token form.
8. Option on, the session is evicted: the dashboard alert offers "Sign in again", and one click restores the dashboard. Disconnect shows a "Sign in" button that does the same.

## Risks / Trade-offs

- [Any local program can get read and control] → Accepted by the owner in #276. It matches the Nanoleaf map on 8765. The option is off by default and named in the configuration. Reassess before LAN, phone or second-operator exposure.
- [A local program can evict the owner's sessions by requesting 16 more] → The same program could already command the devices. The dashboard offers "Sign in again".
- [`pagehide` logout may not arrive] → The session still expires in 8 hours and counts against the cap, as a launcher session does after a reload today.
- [An open tab past 8 hours shows the ended session] → One click on "Sign in again", or a reload.

## Diagnosis and recovery

If the bookmark shows the login page, check that the installed `host.json` has `"browserAccess": "trusted-loopback"` and that the hub was restarted. A 404 from the session route means the option is off. Removing the field turns the feature off after a restart. The launcher and token form keep working either way.
