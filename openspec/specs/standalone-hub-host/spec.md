## Purpose

Provide one optional Linux standalone owner for shared agent monitoring and bounded routing to existing device controllers without moving their private state or physical writers.

## Requirements

### Requirement: Private durable ownership
The host SHALL compose the shared agent-state core with private Linux storage, cross-process exclusivity, atomic revision-checked commits and explicit graceful shutdown.

#### Scenario: Concurrent owner and restart
- **WHEN** another process tries to acquire the occupied store
- **THEN** it fails without changing state, and after owner exit the next owner restores labels, notices and revisions with active evidence uncertain

#### Scenario: Interrupted commit
- **WHEN** a commit fails or the process terminates
- **THEN** restart reads a complete old or new revision and never publishes a speculative partial state

### Requirement: Authenticated bounded shared transport
The host SHALL serve authenticated loopback sessions, ingestion, commands and revisioned changes compatible with Pixoo's selected-source protocol. Authorization SHALL precede replay and preserve privacy, Host/Origin protections and finite resource limits. Revisioned changes SHALL be pushed to open streams as each revision commits, from any admission path, in addition to a periodic timer that covers heartbeats, the per-stream auth recheck and changes that do not commit. A burst of commits SHALL coalesce into at most one flush per open stream. A slow, paused or stalled stream MUST NOT delay ingest, other commits or another stream.

#### Scenario: Unauthorized and oversized requests
- **WHEN** a credential is absent, revoked, out of scope or a request exceeds the declared limits
- **THEN** it is rejected without state or device effects and without echoing secrets or private payloads

#### Scenario: Labels and acknowledgment through selected owner
- **WHEN** a remote Pixoo facade reads or submits an authorized label or notice acknowledgment
- **THEN** the selected shared owner handles it, while no local reducer or second owner starts

#### Scenario: Replay and slow consumers
- **WHEN** a command ticket is repeated or a consumer reconnects after overflow
- **THEN** identical commands retain their result, conflicting tickets reject, and consumers resync current state without replaying effects or delaying healthy consumers

#### Scenario: Committed event reaches an open stream promptly
- **WHEN** a hook ingest, an in-process reader, a label/acknowledge/recovery command or a maintenance commit changes the revision
- **THEN** every open stream is notified without waiting for the periodic timer, and a burst of same-tick commits produces one flush per stream rather than one per commit

#### Scenario: A paused stream cannot delay ingest or other streams
- **WHEN** one open stream is not being read and accumulates backpressure
- **THEN** ingest, other commits and delivery to other open streams continue unaffected, and the paused stream is disconnected only after its own stall deadline

### Requirement: Independent controller routing
The host SHALL route only validated commands to fixed configured owners with separate bounded queues, timeouts and health. It SHALL NOT send device protocols, expose native credentials or automatically retry ambiguous writes.

#### Scenario: Stalled Pixoo
- **WHEN** Pixoo times out while Nanoleaf is responsive
- **THEN** Nanoleaf reads and commands and agent ingestion continue independently, and Pixoo effects remain uncertain after an ambiguous submission

#### Scenario: Versioned integration settings
- **WHEN** a client requests supported Nanoleaf settings or Pixoo monitor settings
- **THEN** the host uses the owning versioned API with revisions, target scope and compatibility fixtures, rejecting absent or incompatible capabilities without widening controller v1

### Requirement: Fenced owner migration
The host SHALL support versioned quiesce/export, empty-destination import, readiness-gated activation and rollback that preserve owner/session identities, revisions, labels and notices. It SHALL resume ingestion only after the old owner has released and producer/consumer routes are ready.

#### Scenario: Interrupted cutover
- **WHEN** destination readiness or consumer switching fails
- **THEN** ingestion remains fenced across restart, no fallback reducer starts, and rollback requires destination release before activating a fresh selected owner

#### Scenario: Rollback after writes
- **WHEN** rollback follows accepted destination writes
- **THEN** a new validated quiesced export preserves those writes in an empty selected store instead of reopening a stale copy

#### Scenario: Release proof and runtime staging
- **WHEN** migration imports a stopped supervised owner's export
- **THEN** import requires one single-use release capability and runtime-enforced staged admission; a copied export or arbitrary PID is insufficient

#### Scenario: Interrupted route update
- **WHEN** the coordinator exits or file synchronization fails after route replacement
- **THEN** durable intent preserves original producer enablement, another live coordinator is refused, and recovery requires known file bytes under an exclusive lease

### Requirement: Reproducible Linux source delivery
The host SHALL provide reproducible packaging, isolated runtime configuration, readiness, shutdown, compatibility documentation and measured responsiveness against the frozen early budget artifact.

#### Scenario: Isolated package and checks
- **WHEN** a fresh Linux consumer installs the built artifact
- **THEN** it can run the host with disposable storage and fake controllers without sibling-checkout imports, real credentials, installed hooks or device operations

#### Scenario: Evidence boundaries
- **WHEN** source checks pass
- **THEN** the report distinguishes them from numeric qualification, installed WSL/client acceptance, physical accuracy and public guide publication

### Requirement: Private bounded browser handoff
The host SHALL issue browser launch codes only through an owner-only local channel. It SHALL accept each code once within a bounded lifetime and issue a time-limited bearer restricted to read/control on configured aliases and the configured playback source ID. The bearer MUST NOT grant ingest, admin or MCP access. Missing, invalid, replayed and expired codes, and disallowed origins MUST fail without state or device effects. Closing or replacing host authority SHALL revoke ephemeral sessions.

When, and only when, the private configuration sets `browserAccess` to `trusted-loopback`, the host SHALL also issue the same browser session, with the same grants, expiry, session limit and retirement, from `POST /api/dashboard/v1/session`. That route SHALL require an allowed loopback Host, an Origin matching that Host, a `Sec-Fetch-Site` that is absent or `same-origin`, `X-Pixoo-Request: 1` and an empty JSON object body. Without the setting the route SHALL answer 404 and issue nothing. Any other `browserAccess` value SHALL be an invalid configuration. Launcher and trusted-loopback sessions SHALL share one session limit.

Disconnect, expiry, oldest-session eviction, credential replacement and host shutdown SHALL retire a browser session through one idempotent path. Retirement SHALL refuse the session's bearer and its cached requests, close its change streams and release its command tickets and settled replay entries. A retired session MUST NOT admit new work, including a monitor, controller, integration or playback write authorized before retirement whose body arrives afterwards. Work the session already admitted SHALL NOT be cancelled or executed again. Its replay accounting SHALL remain charged, and not evictable, until that work settles, and SHALL then be released exactly once. After every browser session retires and its admitted work settles, the host SHALL retain no browser ticket ledger, stream or replay entry. Disconnecting a dashboard that used a configured credential MUST NOT revoke that credential, close its streams or reset its tickets.

#### Scenario: Scoped exchange
- **WHEN** the installed owner requests a launch and exchanges its code from the same-origin page
- **THEN** only that exchange receives a bounded browser session with read/control permission on the configured aliases and the configured playback source

#### Scenario: Unauthorized exchange
- **WHEN** a network caller lacks a current launch code or supplies a disallowed origin
- **THEN** the host rejects it without issuing a bearer or contacting a controller

#### Scenario: Trusted-loopback session
- **WHEN** the configuration sets `browserAccess` to `trusted-loopback` and the same-origin page posts `{}` to the session route with the custom header
- **THEN** it receives a browser session with read/control on the configured aliases and playback source, which cannot ingest, quiesce or authenticate MCP

#### Scenario: Trusted-loopback route off by default
- **WHEN** the configuration has no `browserAccess` field and a caller posts to the session route
- **THEN** the host answers 404 and issues no session

#### Scenario: Trusted-loopback request from elsewhere
- **WHEN** a session request has a foreign Host, a missing, foreign or mismatched Origin, a cross-site `Sec-Fetch-Site`, no `X-Pixoo-Request` header or a body other than `{}`
- **THEN** the host refuses it and issues no session

#### Scenario: Invalid browser access setting
- **WHEN** `browserAccess` is present with any value other than `trusted-loopback`
- **THEN** the host does not start and reports an invalid configuration

#### Scenario: Session revocation
- **WHEN** the user disconnects, the session expires, configured credentials are replaced or the host stops
- **THEN** subsequent requests with the old bearer are refused

#### Scenario: Repeated launches stay bounded
- **WHEN** the owner repeatedly launches or signs in through the trusted-loopback route, reads monitor sessions, submits a command and then disconnects, lets a session expire or exceeds the session limit
- **THEN** each retired session's streams close, its bearer and cached requests are refused, and ticket ledgers and replay accounting return to the configured-credential bound

#### Scenario: Admitted work outlives retirement
- **WHEN** a browser session retires while a command it submitted is still pending, and that command later succeeds or fails
- **THEN** the command runs once, is not reported as cancelled, keeps its replay accounting charged until it settles, and is released once however often retirement repeats

#### Scenario: Late request after retirement
- **WHEN** a monitor, controller or integration write's headers were authorized before its browser session retired and its body arrives afterwards
- **THEN** the host refuses it as unauthenticated, contacts no controller and creates no ticket ledger or replay entry

#### Scenario: Configured credential disconnect
- **WHEN** a dashboard opened with a configured credential disconnects while that credential and another browser session have open streams
- **THEN** both remain usable, their streams stay open, and the configured credential keeps its ticket sequence so an old request returns its retained result and never executes again

#### Scenario: Playback through a browser session
- **WHEN** a launcher-issued browser session reads the playback snapshot, sends a declared playback command or reads the dashboard context on a hub with a configured playback source
- **THEN** the snapshot and command are admitted for that source, the context names the source, and the session still cannot ingest, administer or use MCP

### Requirement: Authorized monitor approval recovery
The host SHALL expose explicit approval recovery only to a control credential. It SHALL validate the full session identity, known turn and expected owner revision, retain command request replay behavior and return a fixed failure when the owner rejects recovery. It SHALL NOT contact a device or provider permission service.

#### Scenario: Guarded control request
- **WHEN** a control client submits recovery for an uncertain approval using a current revision and request ID
- **THEN** the host returns the owner result, and a repeated identical ticket returns the same result without a second mutation

#### Scenario: Unauthorized or stale request
- **WHEN** a client lacks control scope or the owner revision has changed
- **THEN** recovery does not mutate owner state

### Requirement: Optional Codex Desktop read evidence
When configured with a Codex home and a Desktop host and source ID, the host SHALL poll Codex Desktop's unread marker read-only and ingest `read.observed` for top-level sessions from that source. A listed session SHALL become unread. An unlisted session SHALL become read when it was unread, or when its read value is unknown, it is not known to be active, and its last lifecycle evidence is at least five seconds old. The host SHALL emit only when the value changes, SHALL skip child sessions and sessions from other providers, clients, hosts or sources, and SHALL NOT write Codex files or expose marker contents or paths. Missing, oversized, malformed or unexpectedly shaped input SHALL produce no events.

#### Scenario: Completion read in Codex Desktop
- **WHEN** a completed Desktop session was listed as unread and a later marker omits it
- **THEN** the host records it as read without acknowledging its notice

#### Scenario: Completion viewed as it finished
- **WHEN** a Desktop session's turn ended at least five seconds ago, its read value is unknown and the marker never lists it
- **THEN** the host records it as read

#### Scenario: Running turn
- **WHEN** a Desktop session is known to be active, its read value is unknown and the marker does not list it
- **THEN** the host emits no read evidence

#### Scenario: New unread completion
- **WHEN** a session previously recorded as read is listed in the marker again
- **THEN** the host records it as unread

#### Scenario: Unusable marker
- **WHEN** the marker is missing, unreadable, malformed or has an unexpected version or shape
- **THEN** the host emits no read evidence and existing read values are unchanged

#### Scenario: Unrelated sessions
- **WHEN** the owner holds child sessions or sessions from another client, provider, host or source
- **THEN** the host emits no read evidence for them

### Requirement: Optional read-only archive admission evidence
The host SHALL use the configured Codex Desktop home and exact host/source namespace solely to obtain bounded read-only archive evidence for new Desktop record admission. Positive matching archive evidence SHALL prevent admission. Missing configuration, missing/unreadable folders or unavailable evidence SHALL supply no archive evidence. Retirement SHALL work without archive access. The host SHALL NOT poll archives, read transcripts, write or move Codex files, or infer archive state for other installations. An eligible new start after unarchive SHALL be admitted subject to retained delayed-event evidence.

#### Scenario: Archive evidence and unarchive
- **WHEN** an eligible start names an archived conversation in the configured installation, then archive evidence is removed and new work starts
- **THEN** the archived admission is suppressed and the later eligible work creates fresh monitoring with defaults

#### Scenario: Archive evidence unavailable
- **WHEN** configuration or readable archive evidence is absent
- **THEN** ordinary admission remains available and an accepted runtime end still retires known records

### Requirement: Explicit snapshot compatibility
The host SHALL retain its default snapshot 1.0 response and offer explicit snapshot 1.1 selection for generation-aware consumers. Unknown snapshot versions SHALL reject without silently changing consumer semantics. An unavailable feed SHALL NOT become a healthy empty snapshot.

#### Scenario: Legacy and generation-aware readers
- **WHEN** old and upgraded consumers read the same owner revision
- **THEN** default readers receive the closed 1.0 shape, upgraded readers receive native identities plus record generations in 1.1, and both observe actual session removal

### Requirement: Tidbyt and LIFX controller kinds

The host SHALL accept configured controllers of kind `tidbyt` and `lifx` alongside `pixoo` and `nanoleaf`. It SHALL read their controller v1 snapshots with the configured device ID and route their controller v1 commands through the same bounded per-device client, validating snapshots, receipts and identities as for other kinds. Integration settings routes SHALL answer 422 `unsupported-capability` for these kinds without contacting the controller. For a `lifx` component only, the host SHALL serve `GET /api/controllers/v1/<alias>/lighting/snapshot` and `POST /api/controllers/v1/<alias>/lighting/commands`, which forward to the owner's `lifx-light` profile route after the same authorization as other controller routes. It SHALL forward only strict `lifx-light` 1.0.0 color and temperature requests for the configured controller and device, and SHALL accept only a lighting snapshot and a controller v1 receipt whose identity matches. Any other kind SHALL answer 422 on the lighting routes.

#### Scenario: Registered kinds
- **WHEN** `host.json` registers a `tidbyt` alias and a `lifx` alias with loopback `/controller/v1` endpoints and tokens
- **THEN** the hub starts, lists both components with their kinds, and reads and commands them through their own bounded clients

#### Scenario: Owner rejection passes through
- **WHEN** a client sends a controller v1 command that the Tidbyt owner does not support
- **THEN** the hub returns the owner's 422 `unsupported-capability` receipt unchanged and sends nothing else

#### Scenario: Lighting profile routing
- **WHEN** an authorized client posts a valid `lifx.color.set` for a `lifx` alias
- **THEN** the hub forwards exactly that request to the owner's profile route and returns its receipt, and the same request to a `tidbyt`, `pixoo` or `nanoleaf` alias answers 422 without contacting its controller

#### Scenario: Malformed or mismatched lighting data
- **WHEN** a lighting request has an unknown field, a wrong profile or out-of-range value, or the owner returns a lighting snapshot or receipt for another device
- **THEN** the hub rejects the request with 400 before contacting the owner, or treats the response as incompatible or uncertain, without retrying

### Requirement: Read-only Nanoleaf geometry route
For a `nanoleaf` controller, the host SHALL serve `GET /api/controllers/v1/<alias>/integration/geometry` after the same authorization and read scope as the other integration reads. It SHALL read the owner's read-only `GET /controller/integration/v1/geometry` for the configured device through the same bounded per-device client with the native credential, and SHALL return only a response that passes exact validation against the owner's geometry contract and whose controller and device identity match the configuration; any other response SHALL answer `incompatible-controller`. An owner without the route SHALL answer 422 `unsupported-capability` without marking the controller unavailable. Other kinds SHALL answer 422 without contacting the owner. The route SHALL accept no query string or write, and SHALL NOT change the settings snapshot or controller v1. Maps to [codex-nanoleaf#169](https://github.com/jimmie-potts/codex-nanoleaf/issues/169)'s hub consumer criterion.

#### Scenario: Reading the Lines and the Panels
- **WHEN** an authorized client reads the geometry route for a Lines alias and a Panels alias
- **THEN** each returns the owner's validated geometry for its own device, and the owner sees only the native credential

#### Scenario: Device without a saved layout
- **WHEN** the owner reports a device with no saved layout
- **THEN** the route returns its explicit empty result unchanged

#### Scenario: Owner that predates the route
- **WHEN** the owner answers the geometry request with 404 `invalid-request`
- **THEN** the route answers 422 `unsupported-capability`, the controller's health is unchanged and its settings snapshot is still served

#### Scenario: Incompatible geometry
- **WHEN** the owner returns geometry with an extra key, a malformed element or another device's identity
- **THEN** the route answers 502 `incompatible-controller` without passing the response on

### Requirement: Read-only Nanoleaf integration snapshot
The host SHALL accept a `nanoleaf.integration/1.0` snapshot that marks any of `settings.set`, `elements.assign`, `task.assign` and `project.color` as `{supported: false, scope: "control"}`, as the owner reports for a device other than the Lines ([codex-nanoleaf#113](https://github.com/jimmie-potts/codex-nanoleaf/issues/113)). Every other key SHALL keep its exact closed validation. `mode.set` SHALL remain `supported: true` with the controller v1 route, and a capability with any other scope, an extra key or a non-boolean `supported` SHALL answer `incompatible-controller`. The host SHALL NOT add a route or filter extension commands by capability. Maps to [Hub #323](https://github.com/jimmie-potts/agent-device-hub/issues/323).

#### Scenario: Reading the Lines and the Panels
- **WHEN** an authorized client reads the integration snapshot for a Lines alias and a Panels alias that share one owner endpoint and credential
- **THEN** each returns the owner's validated snapshot for its own device, both controllers stay ready, and the owner sees only the native credential

#### Scenario: Malformed unsupported capability
- **WHEN** the owner marks a configuration operation unsupported with another scope, an extra key or a string value, omits one of the four, or marks `mode.set` unsupported
- **THEN** the snapshot answers `incompatible-controller` without passing the response on

### Requirement: Loopback host names
The host SHALL accept `127.0.0.1:<port>` and `localhost:<port>` as the Host of the dashboard page, its assets and its HTTP API. When a request carries an Origin, it SHALL equal `http://` followed by that request's Host. Any other Host, or an Origin naming a different host, SHALL be refused without state or device effects. MCP SHALL keep accepting only its numeric-loopback origin.

#### Scenario: Bookmark on localhost
- **WHEN** the browser loads `http://localhost:<port>/` and its API requests carry Host `localhost:<port>` and Origin `http://localhost:<port>`
- **THEN** the page, assets and authorized API requests are served as they are for `127.0.0.1`

#### Scenario: Mixed or foreign host names
- **WHEN** a request carries Host `localhost:<port>` with Origin `http://127.0.0.1:<port>`, or a Host other than the two loopback names
- **THEN** the host refuses it

### Requirement: Versioned title and project session reads
The authenticated session route SHALL support snapshotVersion=1.2 with title/project metadata while retaining the existing default projection. Label commands SHALL enforce the same 80-scalar bound as the owner.

#### Scenario: Version selection
- **WHEN** old and new clients read sessions
- **THEN** only clients selecting 1.2 receive the new fields

#### Scenario: Label bound
- **WHEN** a client submits a label with 80 Unicode scalars or 81
- **THEN** the former passes the text bound and the latter rejects before state mutation

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

### Requirement: Controller snapshot version negotiation
The host's per-device controller client SHALL read a controller's snapshot with `apiVersion=1.1` when asked for a 1.1 read, and SHALL validate an answer that declares `apiVersion` 1.1 against `snapshotV1_1` and an answer that declares 1.0 against the 1.0 snapshot schema, in each case with the configured controller and device identity. An `invalid-request` refusal of the versioned read SHALL mean the controller serves only 1.0, whether it arrives as the contract's 400 or as the 404 `{"failure":{"code":"invalid-request"}}` the Nanoleaf controller gives for an unknown read parameter: the client SHALL read again without the parameter and SHALL remember a `1.0-only` verdict for the controller epoch of that answer. A 1.0 answer to the versioned read SHALL produce the same verdict without a second read. While a verdict holds, the client SHALL read without the parameter and SHALL NOT probe again as long as the answer carries the same controller epoch. It SHALL probe again when the answer carries a different epoch, and a new client SHALL hold no verdict. That refusal SHALL NOT mark the controller unavailable. A timeout, a 5xx answer, a malformed answer, any other 404 such as `unknown-device`, or any other failure SHALL NOT create, change or clear a verdict. Reads without a version request SHALL send no version parameter. Negotiation SHALL run inside the client's single bounded slot per controller and SHALL send no command.

#### Scenario: 1.1 controller
- **WHEN** the client reads a controller that serves 1.1 at 1.1
- **THEN** it returns the snapshot validated against `snapshotV1_1` after one read

#### Scenario: 1.0-only controller
- **WHEN** the client reads at 1.1 a controller that answers the versioned read with `invalid-request`
- **THEN** it makes exactly one further read without the parameter, returns that 1.0 snapshot and records a `1.0-only` verdict, and later reads in the same epoch make no versioned read

#### Scenario: Controller restarts serving 1.1
- **WHEN** a controller with a `1.0-only` verdict restarts with a new epoch and now serves 1.1
- **THEN** the next 1.1 read returns the 1.1 snapshot and clears the verdict

#### Scenario: Transient failure
- **WHEN** a versioned or unversioned read times out or the controller answers 5xx
- **THEN** the read fails as unavailable and the verdict is unchanged, so a failed probe is repeated on the next read

#### Scenario: No commands
- **WHEN** snapshot reads, negotiation, reconnects or dashboard polls run against a 1.1 or 1.0-only controller
- **THEN** the controller receives no command request

#### Scenario: Controller that refuses the versioned read as an unknown route
- **WHEN** the client reads at 1.1 a controller that answers the versioned read with 404 `invalid-request`
- **THEN** it makes exactly one further read without the parameter, returns that 1.0 snapshot, records a `1.0-only` verdict and keeps the controller's health ready

#### Scenario: Unknown device on the versioned read
- **WHEN** the controller answers the versioned read with 404 `unknown-device`
- **THEN** the read fails with `unknown-device` and no verdict is recorded

### Requirement: Versioned controller snapshot route
`GET /api/controllers/v1/<alias>/snapshot` SHALL return the 1.0 snapshot shape unless the request carries `apiVersion=1.1`, and SHALL send no version parameter to the controller for that default read. With `apiVersion=1.1` it SHALL return the negotiated snapshot: the 1.1 snapshot, including `capabilities.moments` and `state.moment`, for a controller that serves 1.1, and the 1.0 snapshot for a 1.0-only controller. `apiVersion=1.0` SHALL behave as the default. Any other `apiVersion` value, a repeated `apiVersion` or another query parameter SHALL answer 400 `invalid-request` before the controller is contacted, after the same authorization as other controller routes. The route SHALL keep its existing authorization, read scope and errors.

#### Scenario: Default readers
- **WHEN** a dashboard or other reader reads the snapshot route without a parameter for a 1.1 controller or a 1.0-only controller
- **THEN** it receives the closed 1.0 shape and the controller sees no version parameter

#### Scenario: Opt-in 1.1
- **WHEN** a reader adds `apiVersion=1.1`
- **THEN** it receives `capabilities.moments` and `state.moment` from a 1.1 controller, and a 1.0 snapshot from a 1.0-only controller

#### Scenario: Strict parameters
- **WHEN** the request has `apiVersion=1.2`, an empty value, two `apiVersion` values or an extra parameter
- **THEN** the hub answers 400 `invalid-request` and sends nothing to the controller

### Requirement: Bounded controller slot wait for sends
The host's per-device controller client SHALL keep one slot per controller. A send MAY wait for a busy slot for at most 2,500 ms, in arrival order, and SHALL fail with `capacity` without contacting the controller when the bound expires. Every read, including dashboard polls, the controller snapshot route and MCP tools, SHALL keep the immediate `capacity` rejection while the slot is held, including while sends are waiting. Closing the client SHALL fail waiting sends as unavailable.

#### Scenario: Send waits for a read
- **WHEN** a send starts while a dashboard read holds the controller's slot and the read finishes within the bound
- **THEN** the send takes the slot after the read and makes exactly one command POST

#### Scenario: Slot held past the bound
- **WHEN** the slot stays held for longer than 2,500 ms after a send starts waiting
- **THEN** the send returns `capacity` and the controller receives no command POST

#### Scenario: Reads do not wait
- **WHEN** a dashboard or route read arrives while the slot is held or sends are waiting
- **THEN** it is rejected with `capacity` at once

### Requirement: Controller 1.1 moment command path
The controller client SHALL send a 1.1 command only after validating it as `requestV1_1` for the configured controller and device, SHALL POST it to the controller's `/commands` exactly once, and SHALL return the answer only when it validates as `receiptV1_1` with the request's controller, device and ticket, for a 2xx answer or a typed non-2xx receipt. A mismatched or malformed answer, a timeout or a lost response SHALL be `uncertain-result` with no further POST. A typed refusal without a receipt SHALL keep its code. The 1.0 command path SHALL be unchanged and SHALL keep sending `apiVersion` 1.0.

#### Scenario: Receipt for the ticket
- **WHEN** a 1.1 controller answers a moment request with a `receiptV1_1` for the same ticket
- **THEN** the client returns that receipt after one POST

#### Scenario: Ambiguous answer
- **WHEN** the controller times out, drops the connection or answers a receipt for another ticket
- **THEN** the client reports `uncertain-result` after exactly one POST

### Requirement: Hub moment sender
The host SHALL provide an internal moment sender that sends one moment to one controller per call. The sender itself adds no route, MCP tool, page, durable state or arbitration; callers such as the owner moment route and the automation intake apply their own policy. The caller SHALL supply `momentId`, `mood`, optional `palette`, `durationMs`, `priorityClass`, `coversStatus`, an optional start instant on the hub's monotonic clock that defaults to the snapshot's arrival, and an optional `toleranceMs` that defaults to 10,000. The sender SHALL reject invalid input, including a `flourish` with `coversStatus:true`, a `toleranceMs` above 60,000 or a start more than 60,000 ms ahead, before any controller read. For valid input it SHALL wait for the controller's slot within the bounded send wait, read a fresh snapshot through the negotiated 1.1 read inside the same slot, and send nothing unless the snapshot is 1.1 and declares `moments` supported with the requested mood and a `maxDurationMs` of at least `durationMs`. It SHALL then build one `requestV1_1` with the snapshot's `nextRequestId`, configuration revision and generation, the caller's fields unchanged, `start.epoch` from `sampleClock.epoch` and `start.atMs` as `sampleClock.sampledAtMs` plus the hub-monotonic difference between the snapshot's arrival and the start instant, and POST it once. Each call SHALL return exactly one result carrying the `momentId` and the computed start, or no start when no snapshot was read: the controller's receipt; not sent, with `1.0-only`, `moments-unsupported`, `unsupported-capability`, `capacity` or `unavailable`; or `uncertain`. The sender SHALL never resend a moment, and a hub start, reconnect or read SHALL send no moment.

#### Scenario: Request built from the snapshot
- **WHEN** a caller sends a moment to a 1.1 controller that declares `moments` supported
- **THEN** exactly one POST carries a valid `requestV1_1` whose ticket, expected revision and generation equal the snapshot read just before it, whose `start.epoch` is the snapshot's clock epoch and whose `start.atMs` is `sampledAtMs` plus the hub-clock difference between the snapshot's arrival and the start instant

#### Scenario: Same hub instant on two devices
- **WHEN** a caller gives the same start instant to two calls for controllers with different clocks
- **THEN** each request names that hub instant in its own controller's clock

#### Scenario: Not sent
- **WHEN** the target serves only 1.0, declares moments unsupported, lacks the mood or allows a shorter duration
- **THEN** the call returns the matching not-sent reason and the controller receives no command POST

#### Scenario: Ambiguity and receipts
- **WHEN** the POST times out or loses its response, or the controller answers with a failed receipt such as `moment-missed`, `moment-blocked`, `moment-duplicate`, `revision-conflict` or `stale-generation`, or a typed refusal such as `request-order`
- **THEN** the call returns `uncertain` or the typed answer after exactly one POST and sends nothing more

#### Scenario: Independent devices
- **WHEN** a caller sends one moment to three devices concurrently and one is offline
- **THEN** the other two are sent and each call returns its own result

#### Scenario: No replay
- **WHEN** the hub restarts, reconnects or serves snapshot reads and dashboard polls
- **THEN** no controller receives a command POST

### Requirement: Owner moment route
`POST /api/controllers/v1/<alias>/moment` SHALL send one moment to that one device as an explicit owner command. It SHALL require `control` scope for that alias, the same origin and fetch-metadata checks as other controller routes and the `X-Pixoo-Request: 1` mutation header, and SHALL read its body only after authorization. The body SHALL be exactly `{mood, durationMs, coversStatus}` with a contract mood ID, an integer `durationMs` from 1,000 to 300,000 and a boolean `coversStatus`; any other body, a query string or an unknown alias SHALL be refused with a typed error before any controller contact. For a valid body the hub SHALL assign a fresh `momentId` and `priorityClass: "event"`, use the sender's default start and tolerance, call the moment sender exactly once and answer 200 with its typed result: the receipt, a not-sent reason or `uncertain`, with the `momentId` and start. The hub SHALL apply no arbitration; the device's own precedence decides whether the moment plays. The route SHALL answer within the hub's 3 s response cap: when the sender has not returned within the route's bound, it SHALL answer `uncertain` with that `momentId` and SHALL let the one call finish without resending. There SHALL be no MCP tool for this route.

#### Scenario: Scope and header
- **WHEN** a `read` principal, a principal without that alias or a request without the mutation header posts a moment
- **THEN** the hub answers `forbidden` and the controller receives nothing

#### Scenario: Invalid body
- **WHEN** the body adds a palette or another field, names a mood that is not a contract ID, or has a duration below 1,000 or above 300,000 ms
- **THEN** the hub answers 400 `invalid-request` and the controller receives no read and no command

#### Scenario: Undeclared mood or long duration
- **WHEN** the mood is not declared by the device or the duration exceeds its `maxDurationMs`
- **THEN** the hub answers the sender's `not-sent` result with `unsupported-capability` and the controller receives no command

#### Scenario: One send
- **WHEN** a control principal posts a valid moment for a 1.1 device that declares it
- **THEN** exactly one moment request reaches the controller with a fresh `momentId`, `priorityClass: "event"`, the chosen fields and no palette, and the hub answers the typed result

#### Scenario: Slow controller
- **WHEN** the controller holds the moment request past the route's bound
- **THEN** the hub answers `uncertain` within 3 s, and the controller receives that one request and no other

### Requirement: Pixoo catalog and exact representation reads

The Hub SHALL forward typed read-only Pixoo catalog, playlist, manifest and indexed PNG routes to the registered controller using its private token. It SHALL require read scope and the controller alias grant, validate inputs and responses, preserve representation-specific strong ETags and conditional 304 semantics, and share the existing per-device request slot. It MUST NOT reserve command tickets or change the command ledger. Catalog pages SHALL use a limit of 1 to 100, default 25. Negotiated integration snapshot 1.1 SHALL coexist with legacy snapshot and command 1.0.

#### Scenario: Authorized exact preview
- **WHEN** an authorized reader requests a known rendition's manifest and frame
- **THEN** the Hub returns validated timing and PNG bytes with the owner's cache metadata and never exposes the controller token

#### Scenario: Legacy or invalid producer
- **WHEN** the producer supports only 1.0 or returns malformed catalog data
- **THEN** legacy controls continue to work and catalog support is unavailable or the malformed response is rejected

#### Scenario: Conditional access remains checked
- **WHEN** a conditional frame request has a matching ETag but the reader lacks permission or the rendition has been removed
- **THEN** authorization or membership failure is returned instead of 304

### Requirement: Startup-scoped running build identity

The Hub SHALL report `build: {sourceRevision, version}` from its own package metadata in read-authorized health and dashboard context. It MUST retain that identity for the running instance, expose no metadata paths and preserve existing authorization, state-revision meaning and unhealthy status.

#### Scenario: Another release becomes current
- **WHEN** a process is running and its manifest or the installation's current link changes
- **THEN** it continues reporting its startup identity until a restarted process loads its own release, and health and context agree

#### Scenario: Metadata is unavailable or malformed
- **WHEN** its manifest is missing, unreadable, malformed or has invalid identity values
- **THEN** unavailable identity fields report `unknown`, no checkout or symlink lookup invents provenance, and existing health failures remain failures

### Requirement: Truthful Hub package provenance

The Hub archive manifest SHALL stamp the full lowercase source revision from a clean known checkout and MUST stamp `unknown` when source provenance is dirty, unavailable or changes during packaging. Equal versions MUST NOT imply equal source identities.

#### Scenario: Clean and dirty builds
- **WHEN** packaging runs from a clean known commit or from a modified tree
- **THEN** the respective manifest reports that full commit or `unknown`

#### Scenario: Two releases have the same version
- **WHEN** two clean commits keep the same package version
- **THEN** their packaged identities retain their distinct source revisions

### Requirement: Opt-in operational diagnostics
The normal Hub host SHALL support explicit private diagnostic configuration for canonical lifecycle/error logs and useful authenticated HTTP/MCP, controller and owned background-operation traces. It SHALL preserve readiness/result stdout, authentication, device queue ownership and uncertain outcomes. The #730 coverage inventory SHALL identify actual boundaries and deferred coverage.

#### Scenario: Normal host diagnostics enabled
- **WHEN** the host starts with diagnostics enabled and serves an authenticated synthetic command
- **THEN** lifecycle and request/controller outcomes are queryable on the diagnostic channel and correlate to sampled spans without changing command effects or readiness output

#### Scenario: Host diagnostics absent or collection unavailable
- **WHEN** configuration omits diagnostics or an enabled backend is unavailable
- **THEN** domain outcomes and existing command timeouts are preserved and no duplicate operation is attempted

#### Scenario: MCP and owned background work
- **WHEN** an authenticated MCP action or an important owned background action completes or fails
- **THEN** registered outcome metadata identifies that boundary without body capture or invented source/trace context

### Requirement: Versioned host session reads
The authenticated session route SHALL accept `snapshotVersion=1.3` and return the owner's snapshot 1.3, including each record's optional `hostSessionId`. The default, 1.1 and 1.2 projections SHALL remain unchanged. Owner enrichment of Codex Desktop titles SHALL preserve a 1.2 envelope version.

#### Scenario: Version selection
- **WHEN** old and new clients read the sessions route after a Desktop event
- **THEN** only clients selecting 1.3 receive `hostSessionId`
