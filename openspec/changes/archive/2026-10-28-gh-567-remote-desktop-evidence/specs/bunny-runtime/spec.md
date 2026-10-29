## MODIFIED Requirements

### Requirement: Runtime gateway callers

With an edge, the runtime's gateway SHALL serve every route of the listener but health, and every refusal SHALL be the shared error body with a code from the 2.0 registry at the HTTP status that fits it, with fixed text that quotes nothing the caller sent, and every JSON answer, health's included, SHALL carry `x-content-type-options: nosniff`. A caller SHALL be either a client credential, which presents its bearer token and SHALL carry no `Origin` and no `Sec-Fetch-Site` other than `none`, or a browser session, which the `bunny-session` cookie carries (`HttpOnly`, `SameSite=Strict`, eight hours, at most 16 sessions) and which acts as `bunny/parts/dashboard` with `read` and `control`. No caller SHALL be limited to some devices (owner decision, 2026-10-07). A browser session SHALL be presented only by this origin's own pages or the browser itself: an `Origin` or `Sec-Fetch-Site` of another site SHALL be refused with `forbidden`, and a change (any method but GET or HEAD) SHALL name this origin and carry `bunny-request: 1`. For local access this origin SHALL be `http://` and the host the request names, `127.0.0.1:<port>` or `localhost:<port>`, so a page on the other loopback name is another origin. The optional home-Wi-Fi entry SHALL use its explicitly configured HTTPS origin only after authenticating its proxy; it SHALL preserve the browser's Host and Origin rather than impersonating loopback. When a request carries several session cookies, the one that is a live session SHALL be taken. A credential presented from a page SHALL be refused with `forbidden`, a made-up or revoked token and a request with neither with `unauthenticated`.

A browser SHALL sign in only from this origin's own page, naming it and carrying `bunny-request: 1`: with a launch code at `POST /api/v2/browser/launch`, or, when the edge section sets `browserAccess` `trusted-loopback`, at `POST /api/v2/browser/session`, which otherwise answers `not-found` unless the request uses an authenticated home-Wi-Fi or private entry. The runtime SHALL serve the launcher's socket, `bunny-launch.sock` in its state directory, owner-only, unless the edge section sets `launcher` false; each connection SHALL get the runtime's origin and a code good once for 30 seconds, at most eight waiting. A socket path over 107 bytes SHALL refuse the start with `launcher-path-too-long`. `POST /api/v2/browser/logout` SHALL end the cookie's session and its streams and clear the cookie, and a session evicted by the seventeenth or ended at its expiry SHALL have its streams ended at once too. A session token SHALL travel only in `Set-Cookie`.

At the SDK edge, each caller's scopes SHALL become its grant's calls, routing keys and families: `read` SHALL subscribe and sync every state and event key, `ingest` SHALL publish the `lifecycle` family on `bunny.event.lifecycle.*` and the `desktop-metadata` family on `bunny.event.desktop-metadata.*` only (Hub #567), `control` SHALL request the core's operator commands only, `bunny.cmd.approval-recover.*` and `bunny.cmd.notice-acknowledge.*`, which the core's dispatcher names (Hub #782), and send every other command through the action routes (see "Action routes"), and `admin` SHALL add nothing. So a hook's credential with `ingest` SHALL be refused with `forbidden` for any command, read, subscription or other family's message. On every entry, a `desktop-metadata` message SHALL be published only by a credential whose source is derived from the snapshot's feed with the `feed: desktop-metadata` member (`producerSource`); a hook's derived credential, a credential of another feed or any other source SHALL be refused with `forbidden` before the bus has the message, and the lifecycle identity binding of the private entry SHALL stay as it is.

The optional private HTTPS entry SHALL require an explicitly configured canonical origin and valid private proxy proof, preserve Host/Origin, and refuse absent, forged, mixed private/Wi-Fi proof or mismatched hosts. Network membership and forwarded identity headers SHALL grant no authority. It SHALL admit owner-password-authenticated browsers into existing Secure sessions and ordinary source-scoped read/control/ingest machine credentials through the existing gateway. Bearer credentials SHALL NOT create browser sessions; health, launcher, MCP, administrative credentials and special device roles SHALL be refused at this entry, including after credential reload. Revocation SHALL end the affected streams and further access. Local access and the browser-only Wi-Fi entry SHALL retain their existing behavior.

#### Scenario: Registry codes for every refusal
- **WHEN** credentials send a malformed family name, a query a route does not take, a recovery that is not JSON or over the body limit, a made-up token, no token, a hook's read, a reader's recovery and a scope the caller lacks
- **THEN** they answer 400 `invalid-request`, 400, 400, 413 `too-large`, 401 `unauthenticated`, 401, 403 `forbidden`, 403 and 403, each the shared error body with only its code, flag and detail, and a hook's command through the SDK edge is `forbidden`, as is its moment occurrence on a lifecycle key, which nobody hears

#### Scenario: Origin checks
- **WHEN** a credential's request names this or another origin or carries fetch metadata from a page, sign-in comes without the request header or from another site, and a session cookie is used from another site, from the same site or for a change without the header
- **THEN** each is refused with `forbidden`, a proper sign-in sets an `HttpOnly`, `SameSite=Strict` cookie whose token appears in no body, the session reads from this origin and a bookmark, MCP refuses it, and logout ends it

#### Scenario: The launcher
- **WHEN** the launcher asks the runtime's socket for a code, the page exchanges it, and the same code or a made-up one is tried again, with trusted loopback sign-in off
- **THEN** the first exchange signs the browser in and its page loads, the others are `unauthenticated`, trusted loopback sign-in answers `not-found`, and no record holds the code

#### Scenario: A bookmark on localhost
- **WHEN** a page on `http://localhost:<port>` signs in, reads and recovers an approval through requests that name `localhost:<port>`, a page on `127.0.0.1` signs in through one that names `localhost`, and a request carries a stale session cookie before the live one
- **THEN** the sign-in, the read and the change are served, the other loopback name's sign-in is `forbidden`, and the live cookie is taken

#### Scenario: Sessions that end without a logout
- **WHEN** a browser session holds an SDK stream and sixteen more sessions open, and later the newest session, holding a stream, reaches its expiry
- **THEN** the evicted and the expired sessions' streams end at once, logged for `bunny/parts/dashboard`, and each cookie is `unauthenticated`

#### Scenario: Reads no module can answer
- **WHEN** a caller reads a family no module in the runtime serves, by family and by snapshot, and a snapshot of two owners' families, and later the family of a module whose page failed it
- **THEN** the first two are `not-found`, not retryable, saying no module serves it, and the third `invalid-request`, saying to name families that one module serves; and once the only module that serves a family fails, its family read and its snapshot are `unavailable`, retryable, saying the module is not running

#### Scenario: No reader limited to some devices
- **WHEN** a reader with `read` alone reads the family of a module that names two devices in its configuration, a snapshot of it at schema version 2.1, the links and the module list, opens the module's page, content and settings, and syncs the family through the SDK edge
- **THEN** it reads both devices' records and editor links, the module is listed with its page, tool and settings and each of them answers, and its copy and the answer's membership hold both devices

#### Scenario: Home Wi-Fi owner session
- **WHEN** the owner opens the configured HTTPS entry through its authenticated local proxy and signs in
- **THEN** the existing browser session permits reads and controls, its cookie is Secure, HttpOnly and SameSite=Strict, and expiry and logout end its streams exactly as local sessions do

#### Scenario: Untrusted proxy requests
- **WHEN** the proxy proof is absent, forged or paired with a different Host, or another origin tries sign-in or cookie use
- **THEN** the runtime refuses the request without admitting a browser, exposing state or sending a command; forwarded headers alone confer no authority

#### Scenario: Browser-only Wi-Fi entry
- **WHEN** the Wi-Fi entry carries a machine bearer credential, calls health, MCP or launch-code exchange, or is disabled and then called again
- **THEN** the request is refused, while ordinary loopback browsers, launcher and machine credentials retain their existing behavior

#### Scenario: Private browser and scoped machine access
- **WHEN** the configured private entry carries an authenticated owner browser or an ordinary scoped machine credential
- **THEN** browser sessions retain read/control, Secure cookies, expiry and logout, while machines retain their own source/scopes and cannot exchange their credential for a browser session

#### Scenario: Private proxy refusal and removal
- **WHEN** a request uses forged/mixed proof, a different host or browser origin, an administrative/device-role credential, a local-only route, or a removed private entry
- **THEN** it is refused before effects; forwarded identity grants nothing and normal local clients remain usable

#### Scenario: Private container profile
- **WHEN** the owner explicitly selects the private-proxy container profile
- **THEN** it requires private-entry configuration, preserves loopback publication, the dedicated network and non-device module admission, disables device control and admits only ordinary scoped clients plus the unchanged selected local ingest-only producer
- **AND** the default host-local profile refuses private-entry configuration and retains its stricter credential policy

#### Scenario: A collector's and a hook's credentials
- **WHEN** an ingest credential derived from a Desktop feed with the `feed` member publishes a snapshot of that feed, the same credential publishes a snapshot of another feed, a hook's four-member credential publishes a snapshot, and a read credential publishes one
- **THEN** the first reaches the bus from that source and the core changes no session for it, and the three others are refused with `forbidden`
