## Why
[Hub #561](https://github.com/jimmie-potts/agent-device-hub/issues/561): a link from another local app into B.U.N.N.Y. shows `{"error":{"code":"forbidden"}}`. The owner hit it on 2026-09-28 in the integrated preview `compose-20260928T173157Z-7ab0f8`, through the wall's B.U.N.N.Y. link. The installed wall links to `http://127.0.0.1:8788/` (codex-nanoleaf#191), so it very likely fails too; nobody probed the installed Hub.

The page route accepts `Sec-Fetch-Site` only when absent, `none` or `same-origin`, a rule from the first dashboard (#127) that #419 moved into `sameOrigin`. Chromium sends a link from another port of the same host as `same-site`, so the page is refused. Hub #495's `integrated-lifecycle` step read the link's `href` without following it, so the broken link passed.

## What Changes

- The Hub also serves the page at `/` to a top-level document navigation from another page on the same site: `Sec-Fetch-Site: same-site`, `Sec-Fetch-Mode: navigate`, `Sec-Fetch-Dest: document`, no `Origin`, and a Host that is one of the loopback names.
- Everything else keeps today's rule. A cross-site navigation, a frame, iframe, object or embed request, a fetch or subresource request, a same-site request with an Origin and any other Host are refused. The dashboard assets, every API route, the trusted-loopback session route and the launch exchange still refuse same-site requests.
- The page's responses add `X-Frame-Options: DENY` to the existing `Content-Security-Policy: frame-ancestors 'none'`, and `Cross-Origin-Opener-Policy: same-origin`, so a linking page cannot keep a handle to the tab and reload it until the session cap evicts the owner.
- The Hub verification's `integrated-lifecycle` step clicks the Hub's Places Wall link and the wall's B.U.N.N.Y. link. It asserts that each opens its page in a new tab, the dashboard signed in and showing the step's session.

`design.md` has the threat model and the residual: each click from another local app opens one signed-in tab. Direct links from another host name stay refused, including a `localhost` page linking to `127.0.0.1`, a guide opened from a file and the public guide (#563, codex-nanoleaf#199). The owner decided to deliver this on 2026-09-28 ([#561 comment](https://github.com/jimmie-potts/agent-device-hub/issues/561#issuecomment-5877999564)).

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `standalone-hub-host`: adds a requirement for the dashboard page reached by a link from another local app.
- `unified-dashboard`: the local owner browser launch requirement gains a scenario for opening the dashboard from another local app's link.

## Impact

Changes the page route in `apps/hub/src/server.ts`. Adds `apps/hub/tests/linked-navigation.test.mjs`, a Chromium check in `apps/dashboard/tests/trusted.mjs` and link-following assertions in `apps/hub/verify/integrated-steps.mjs`. Updates the hub README, the dashboard README, `docs/development.md`, `docs/app-verification.md` and the verification feature map. The dashboard UI, API, controller contracts, credentials, state and devices do not change. The installed Hub changes only when a named owner installs a reviewed package. The live check of the installed wall's link belongs to that installation.
