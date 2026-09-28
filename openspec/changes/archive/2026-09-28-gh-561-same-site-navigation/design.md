## Context

See `proposal.md` for the defect. The Hub listens on `127.0.0.1` only. Every browser request passes `sameOrigin`: the Host is `127.0.0.1:<port>` or `localhost:<port>` for the listener, a supplied Origin names that same host, and `Sec-Fetch-Site` is absent, `none` or `same-origin`. Writes also need `X-Pixoo-Request: 1`. A browser session comes only from a same-origin `POST`: the launch exchange, with a code from the owner-only socket, or, with `browserAccess: "trusted-loopback"`, the session route (Hub #276). The page is static and holds no secret. Its responses already carry `Content-Security-Policy` with `frame-ancestors 'none'`.

Chromium computes `Sec-Fetch-Site` from the scheme and host of the page that started the request, ignoring the port. A link from `http://127.0.0.1:8765/` to `http://127.0.0.1:8788/` is `same-site`. A link from `http://localhost:8765/`, a `file://` page or an `https://` page is `cross-site`. `apps/dashboard/tests/trusted.mjs` asserts the first two in Chromium, and a logging-server probe recorded in the PR shows the rest.

This change relaxes an authorization boundary. The owner decided on 2026-09-28 to deliver it, after being told it loosens the #276/#419 boundary ([#561 comment](https://github.com/jimmie-potts/agent-device-hub/issues/561#issuecomment-5877999564)). Examples 1 to 5 below were fixed before implementation. Examples 6 and 7 were added, and failed first, after the first Standards review found the eviction loop.

## Goals / Non-Goals

**Goals:** a link from another local app on the same host name opens the dashboard, signed in when trusted-loopback is on. The assets, every API route, the session route and the launch exchange stay as strict as they are. The page cannot be framed, and the linking page cannot keep a handle to its tab. The verification follows the links instead of reading an `href`.

**Non-Goals:** links from another host name, a `file://` guide or the public guide. They are `cross-site`, and the request says nothing about where it came from: `rel=noreferrer` sends no Referer. [#563](https://github.com/jimmie-potts/agent-device-hub/issues/563) tracks the guide's link, and [codex-nanoleaf#199](https://github.com/jimmie-potts/codex-nanoleaf/issues/199) a wall opened as `localhost`. Also out of scope: refusing browser prefetches, which arrive as `none` like a bookmark ([#564](https://github.com/jimmie-potts/agent-device-hub/issues/564)); LAN or phone access; a cookie; and any change to the wall's or Pixoo's own pages.

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
- Admit `cross-site` navigations too, so the guide's link works. Rejected: any website could then open the dashboard with a plain link or `window.open`, and a navigation carries no trustworthy sign of where it came from. A website can still reach the page through a prefetch, which arrives as `none`; see the threat model.
- Require the Referer to name a loopback page. Rejected: the wall's link and the Places links use `rel=noreferrer`, so they send none.

### Refuse framing twice

The page keeps `frame-ancestors 'none'` and adds `X-Frame-Options: DENY`, which older engines honour. A same-site frame request is also refused by the server, because its `Sec-Fetch-Dest` is `iframe` or `frame`.

### Sever the opener

The page sends `Cross-Origin-Opener-Policy: same-origin`. A tab that loads the dashboard from another origin moves to its own browsing context group, and the page that opened it keeps only a closed handle. The first Standards review showed why this is needed. A page on another loopback port opened the Hub with `window.open` and set the window's location back to the Hub every 10 to 30 ms. Each load signed in before its `pagehide` logout could retire the previous session, so sessions piled up to the 16-session cap and evicted the owner's within about two seconds. With the header the handle is closed after the first load. The loop stops, and the Hub holds the owner's session and the one opened tab. Legitimate links use `rel="noopener noreferrer"` and hold no handle, so they are unaffected.

Alternatives considered: requiring `Sec-Fetch-User: ?1` does not help, because the loop's window carries the click's activation; refusing the navigation altogether would bring back the defect.

## Threat model

An attacker here is a page served from another port on the same host name, or a program that serves one. That app can already:

- open the dashboard in a new tab through the system browser;
- with trusted-loopback on, post to the session route as a non-browser client, the assurance #276 accepted.

After this change, a page of that app can also open the dashboard with a link or navigation. The dashboard then runs in its own origin. The linking page cannot read or script it, because the browser keeps the two origins apart and the dashboard listens for no messages. It cannot frame the dashboard or call its API either. Sign-in is the page's own same-origin `POST` with `X-Pixoo-Request`. A fragment the linking page chooses can select a view or name a launch code; a code it does not hold fails, and nothing on the page acts by itself. Browsers set `Sec-Fetch-*`; page scripts cannot.

Each load of the dashboard signs in and creates a session, so a page that could reload the dashboard repeatedly could fill the 16-session cap and evict the owner. The opener policy is what prevents that: the linking page loses its window handle on the first load and cannot navigate the tab again. The cap then bounds what remains. Each click or navigation from such a page opens one signed-in tab. The tab logs its session out on `pagehide` and otherwise expires in 8 hours. That is the residual this change accepts, and it matches what the owner's system browser opener already allows a local program.

The cross-site refusal covers direct navigations only. Chromium sends a speculation-rules prefetch of the page with `Sec-Fetch-Site: none` and `Sec-Purpose: prefetch`, and a later click on the prefetching page's link shows the prefetched page, which then signs in. This predates the change: `none` is admitted for bookmarks and the system browser. So a website can still open one signed-in tab per click on its link, and the opener policy keeps it from holding a handle to that tab. Whether to refuse prefetches is [#564](https://github.com/jimmie-potts/agent-device-hub/issues/564).

## Acceptance examples

1. A `GET /` with `Sec-Fetch-Site: same-site`, `Mode: navigate`, `Dest: document`, no Origin and Host `127.0.0.1:<port>` or `localhost:<port>` answers 200 with the page, `X-Frame-Options: DENY` and `frame-ancestors 'none'`, and issues no session.
2. The same request answers 403 `forbidden` when `Sec-Fetch-Site` is `cross-site`, when `Dest` is `iframe`, `frame`, `object` or `embed`, when `Mode` is not `navigate`, when `Mode` or `Dest` is missing, when an Origin is present, or when the Host is another name or port.
3. `/dashboard.js`, `/dashboard.css`, the context, sessions, changes, health, commands and logout routes, the session route and the launch exchange answer 403 to same-site requests. A refused launch exchange leaves its code usable.
4. In Chromium, a link on `http://127.0.0.1:<other>/` to the Hub opens a new tab with the dashboard signed in, and closing the tab logs its session out. The same holds between two `localhost` ports. A link on `http://localhost:<other>/` to `127.0.0.1` is refused, and an iframe of the Hub on the other app shows the refusal and signs nothing in.
5. `integrated-lifecycle` fails at "the wall's B.U.N.N.Y. link opens the paired Hub's dashboard signed in, with the session, in a new tab" on the pre-fix Hub and passes after.
6. Every page response carries `Cross-Origin-Opener-Policy: same-origin`, however the page was reached.
7. In Chromium, with the owner signed in, a page on another loopback port opens the Hub with `window.open` and re-navigates that window every 10 to 30 ms for eight seconds. The owner's session keeps answering, the Hub never holds more than two sessions, and the page's handle reports closed. Without the opener policy the owner is evicted within about two seconds.

## Risks / Trade-offs

- [A local page can open signed-in tabs] → One tab per click or navigation, because the opener policy severs its handle; a scripted reload loop cannot evict the owner. It could already open tabs through the system browser or post to the session route itself. Each tab logs out on `pagehide`, and sessions stay capped at 16 and expire in 8 hours.
- [A website can open a signed-in tab through a prefetch] → Predates this change. One tab per click on its link, with no handle kept. Whether to refuse prefetches is [#564](https://github.com/jimmie-potts/agent-device-hub/issues/564).
- [A link from another host name still shows Forbidden] → Open both apps under the same host name. The wall prints `http://127.0.0.1:8765`. The guide's B.U.N.N.Y. link from a file or the public edition stays refused; #563 tracks it, and codex-nanoleaf#199 a wall opened as `localhost`.
- [A browser that sends no fetch metadata] → It is served as before. The rule only relaxes one `same-site` case.

## Diagnosis and recovery

If a link into B.U.N.N.Y. shows `{"error":{"code":"forbidden"}}`, check the Hub build first: a Hub without this change refuses every link. Then read the navigation's request headers in the browser's developer tools. `Sec-Fetch-Site: cross-site` means the linking page uses another host name or scheme: open it as `http://127.0.0.1:<port>`, or open B.U.N.N.Y. from a bookmark. `Sec-Fetch-Dest: iframe` means the page was framed, which stays refused. Reverting the change restores the old refusal with no state to migrate.
