## Context

See `proposal.md` for the defect. The Hub listens on `127.0.0.1` only. Every browser request passes `sameOrigin`: the Host is `127.0.0.1:<port>` or `localhost:<port>` for the listener, a supplied Origin names that same host, and `Sec-Fetch-Site` is absent, `none` or `same-origin`. Writes also need `X-Pixoo-Request: 1`. A browser session comes only from a same-origin `POST`: the launch exchange, with a code from the owner-only socket, or, with `browserAccess: "trusted-loopback"`, the session route (Hub #276). The page is static and holds no secret. Its responses already carry `Content-Security-Policy` with `frame-ancestors 'none'`.

Chromium computes `Sec-Fetch-Site` from the scheme and host of the page that started the request, ignoring the port. A link from `http://127.0.0.1:8765/` to `http://127.0.0.1:8788/` is `same-site`. A link from `http://localhost:8765/`, a `file://` page or an `https://` page is `cross-site`. `apps/dashboard/tests/trusted.mjs` asserts the first two in Chromium, and a logging-server probe recorded in the PR shows the rest.

This change relaxes an authorization boundary, so the acceptance examples below were fixed before implementation.

## Goals / Non-Goals

**Goals:** a link from another local app on the same host name opens the dashboard, signed in when trusted-loopback is on. The assets, every API route, the session route and the launch exchange stay as strict as they are. The page cannot be framed. The verification follows the links instead of reading an `href`.

**Non-Goals:** links from another host name, a `file://` guide or the public guide. They are `cross-site`, and the request says nothing about where it came from: `rel=noreferrer` sends no Referer. Also out of scope: LAN or phone access, a cookie, and any change to the wall's or Pixoo's own pages.

## Decisions

### Admit only a same-site top-level document navigation to `/`

The page route serves `/` when `sameOrigin` passes, or when the request is a linked page navigation:

- `Sec-Fetch-Site: same-site`;
- `Sec-Fetch-Mode: navigate` and `Sec-Fetch-Dest: document`, so a top-level browsing context, not a frame, object, embed, fetch or subresource;
- no `Origin`, which a browser omits on a `GET` navigation;
- a Host that is one of the loopback names, so a rebinding name is refused as before.

`/dashboard.js` and `/dashboard.css` keep `sameOrigin`. Once the page loads, its own requests are `same-origin`. Every API route, the session route and the launch exchange are unchanged.

`Sec-Fetch-User` is not required. A redirect or script navigation from a local page grants no more than a click. Another local program can already open the page through the system browser, which the browser sends as `none`.

Alternatives considered:

- Admit `same-site` everywhere through `sameOrigin`. Rejected: it would let another local app fetch the API and post to the session route from a page.
- Admit `cross-site` navigations too, so the guide's link works. Rejected: any website could open sign-ins that crowd the owner's sessions out of the 16-session cap, and a navigation carries no trustworthy sign of where it came from.
- Require the Referer to name a loopback page. Rejected: the wall's link and the Places links use `rel=noreferrer`, so they send none.

### Refuse framing twice

The page keeps `frame-ancestors 'none'` and adds `X-Frame-Options: DENY`, which older engines honour. A same-site frame request is also refused by the server, because its `Sec-Fetch-Dest` is `iframe` or `frame`.

## Threat model

An attacker here is a page served from another port on the same host name, or a program that serves one. That app can already:

- open the dashboard in a new tab through the system browser;
- with trusted-loopback on, post to the session route as a non-browser client, the assurance #276 accepted.

After this change, a page of that app can also open the dashboard with a link or navigation. The dashboard then runs in its own origin. The linking page cannot read or script it, because the browser keeps the two origins apart and the dashboard listens for no messages. It cannot frame the dashboard or call its API either. Sign-in is the page's own same-origin `POST` with `X-Pixoo-Request`. A fragment the linking page chooses can select a view or name a launch code; a code it does not hold fails, and nothing on the page acts by itself. Browsers set `Sec-Fetch-*`; page scripts cannot. So the change grants nothing new. It stops refusing a tab that another local program could already open.

## Acceptance examples

1. A `GET /` with `Sec-Fetch-Site: same-site`, `Mode: navigate`, `Dest: document`, no Origin and Host `127.0.0.1:<port>` or `localhost:<port>` answers 200 with the page, `X-Frame-Options: DENY` and `frame-ancestors 'none'`, and issues no session.
2. The same request answers 403 `forbidden` when `Sec-Fetch-Site` is `cross-site`, when `Dest` is `iframe`, `frame`, `object` or `embed`, when `Mode` is not `navigate`, when `Mode` or `Dest` is missing, when an Origin is present, or when the Host is another name or port.
3. `/dashboard.js`, `/dashboard.css`, the context, sessions, changes, health, commands and logout routes, the session route and the launch exchange answer 403 to same-site requests. A refused launch exchange leaves its code usable.
4. In Chromium, a link on `http://127.0.0.1:<other>/` to the Hub opens a new tab with the dashboard signed in, and closing the tab logs its session out. The same holds between two `localhost` ports. A link on `http://localhost:<other>/` to `127.0.0.1` is refused, and an iframe of the Hub on the other app shows the refusal and signs nothing in.
5. `integrated-lifecycle` fails at "the wall's B.U.N.N.Y. link opens the paired Hub's dashboard signed in, with the session, in a new tab" on the pre-fix Hub and passes after.

## Risks / Trade-offs

- [A local page can open signed-in tabs] → It could already open them through the system browser or post to the session route itself. Each tab logs out on `pagehide`, and sessions stay capped at 16 and expire in 8 hours.
- [A link from another host name still shows Forbidden] → Open both apps under the same host name. The wall prints `http://127.0.0.1:8765`. The guide's B.U.N.N.Y. link from a file or the public edition stays refused; that needs its own decision.
- [A browser that sends no fetch metadata] → It is served as before. The rule only relaxes one `same-site` case.

## Diagnosis and recovery

If a link into B.U.N.N.Y. shows `{"error":{"code":"forbidden"}}`, check the Hub build first: a Hub without this change refuses every link. Then read the navigation's request headers in the browser's developer tools. `Sec-Fetch-Site: cross-site` means the linking page uses another host name or scheme: open it as `http://127.0.0.1:<port>`, or open B.U.N.N.Y. from a bookmark. `Sec-Fetch-Dest: iframe` means the page was framed, which stays refused. Reverting the change restores the old refusal with no state to migrate.
