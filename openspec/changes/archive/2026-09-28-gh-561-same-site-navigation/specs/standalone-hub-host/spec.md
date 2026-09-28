## ADDED Requirements

### Requirement: Dashboard page linked from another local app
The host SHALL serve the dashboard page at `/` when the request's `Sec-Fetch-Site` is absent, `none` or `same-origin`, and also to a top-level document navigation from another page on the same site: `Sec-Fetch-Site: same-site`, `Sec-Fetch-Mode: navigate` and `Sec-Fetch-Dest: document`, with no Origin header and an allowed loopback Host. Every other same-site or cross-site request for the page SHALL be refused without state or device effects, including a cross-site navigation, a frame, iframe, object or embed navigation, a fetch or subresource request, a same-site request that carries an Origin, and any request whose Host is not an allowed loopback name. The dashboard assets, every API route, the trusted-loopback session route and the launch exchange SHALL keep refusing same-site requests. Serving the page SHALL issue no browser session. The page SHALL be served with a `Content-Security-Policy` containing `frame-ancestors 'none'`, with `X-Frame-Options: DENY` and with `Cross-Origin-Opener-Policy: same-origin`, so no page can frame it or keep a handle to its tab.

#### Scenario: Link from another local app
- **WHEN** the owner clicks a link to the dashboard on a page served from another port of the same loopback host name, such as the wall's B.U.N.N.Y. link
- **THEN** the host serves the page with its framing protections, and the page signs in only through its own same-origin session request or launch exchange

#### Scenario: Framed, fetched or foreign request for the page
- **WHEN** another loopback app frames or fetches the page, a same-site request for the page carries an Origin or another Host, or a page on another site or host name links to it
- **THEN** the host refuses it as forbidden and issues no session

#### Scenario: Repeated navigation from another local app
- **WHEN** the owner is signed in, and a page on another loopback port opens the dashboard in a window and keeps navigating that window back to the dashboard
- **THEN** the page loses its handle to the window after the first load, the owner's session is not evicted, and the host holds no more than the owner's session and the one opened tab

#### Scenario: Assets and API from another local app
- **WHEN** another loopback app requests the dashboard assets, an API route, the session route or the launch exchange with same-site fetch metadata
- **THEN** the host refuses it as forbidden, issues no session and leaves an unused launch code valid
