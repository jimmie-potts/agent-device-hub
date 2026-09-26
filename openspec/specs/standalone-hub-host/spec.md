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

Disconnect, expiry, oldest-session eviction, credential replacement and host shutdown SHALL retire a browser session through one idempotent path. Retirement SHALL refuse the session's bearer and its cached requests, close its change streams and release its command tickets and settled replay entries. A retired session MUST NOT admit new work, including a monitor, controller, integration or playback write authorized before retirement whose body arrives afterwards. Work the session already admitted SHALL NOT be cancelled or executed again. Its replay accounting SHALL remain charged, and not evictable, until that work settles, and SHALL then be released exactly once. After every browser session retires and its admitted work settles, the host SHALL retain no browser ticket ledger, stream or replay entry. Disconnecting a dashboard that used a configured credential MUST NOT revoke that credential, close its streams or reset its tickets.

#### Scenario: Scoped exchange
- **WHEN** the installed owner requests a launch and exchanges its code from the same-origin page
- **THEN** only that exchange receives a bounded browser session with read/control permission on the configured aliases and the configured playback source

#### Scenario: Unauthorized exchange
- **WHEN** a network caller lacks a current launch code or supplies a disallowed origin
- **THEN** the host rejects it without issuing a bearer or contacting a controller

#### Scenario: Session revocation
- **WHEN** the user disconnects, the session expires, configured credentials are replaced or the host stops
- **THEN** subsequent requests with the old bearer are refused

#### Scenario: Repeated launches stay bounded
- **WHEN** the owner repeatedly launches, reads monitor sessions, submits a command and then disconnects, lets a session expire or exceeds the session limit
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
