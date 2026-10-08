## MODIFIED Requirements

### Requirement: Module manifest and API version

Each module SHALL declare a manifest with a name and the module API version it was written for, and SHALL be written against the module API in `@jimmie-potts/sdk`. The runtime SHALL refuse, and never start, a module whose name is not lowercase letters and digits with single hyphens of at most 64 characters, whose name another module already has, whose `apiVersion` is not `<major>.<minor>`, whose API version has another major version or a newer minor version than the runtime's, `1.3`, or whose pages, content, tools or settings the SDK's `checkContributions` refuses: a module written for `1.0` or `1.1` that declares any of them, a page ID that is not distinct or is `content` or `assets`, an interactive page or trusted asset declared before API 1.3, a tool whose input allows other members, settings without `configure`. It SHALL also refuse a module whose tool schemas do not compile as strict JSON Schema 2020-12, or whose tool takes an argument named `deviceId`, `controllerId`, `url`, `ip`, `path`, `credential` or `authorization`, which the MCP gateway keeps. A refused module SHALL get no participant on the bus, and health SHALL list it as `refused` with the reason. The other modules SHALL start.

#### Scenario: An incompatible module is refused
- **WHEN** modules declare API versions `2.0`, `1.4`, `0.9`, `one`, `1.3` and `1.0` to a runtime that supports `1.3`
- **THEN** only the `1.3` and `1.0` modules start, health is `degraded` with status 200, the first three are `refused` with `unsupported-version` and the fourth with `invalid-request`, and a request to a key the refused module would answer is `unavailable`

#### Scenario: Version matching
- **WHEN** a module's API version is compared with a runtime's `1.3`
- **THEN** `1.3`, `1.2` and `1.0` match, `1.4`, `2.0` and `0.2` are `unsupported-version`, and `1`, `1.0.0`, `v1.0`, `01.0`, `1.x` and an empty version are `invalid-request`

#### Scenario: Malformed and duplicate names
- **WHEN** two modules share a name, or a module's name has uppercase letters, an underscore, a leading or trailing hyphen, no characters or more than 64
- **THEN** the first module with a valid name runs, and each other one is `refused` with `invalid-request` and never started

#### Scenario: Contributions the runtime would not serve
- **WHEN** a `1.1` module declares a page, a `1.2` module names a page `content`, another declares settings without `configure`, and a fourth declares a valid page
- **THEN** the first three are `refused` with `invalid-request` and a fixed detail naming the problem, and the fourth runs

### Requirement: Gateway routes

The gateway SHALL serve, to a caller with `read`: `GET /api/v2/families/<family>`, every record of a core, device or module state family, combining, for a family that several modules serve such as `device`, each owner's records in one answer, each from a copy of that owner it syncs on the first read and keeps following, at most 32 copies, never by polling (a malformed name `invalid-request`, an unknown family `not-found`, a family no module in this runtime serves or served `not-found` with text that says so, one whose every owner is a module that has failed or stopped, or cannot be read, `unavailable`, and an only owner's refusal its code with fixed text for that code). An owner that is down or cannot be read SHALL never fail the others (policy A): the answer SHALL carry `unavailable`, the sources of those owners alone, empty when every owner answered, so a reader never takes their records for absent; `GET /api/v2/snapshot?families=<a>,<b>[&owner=<source>]`, one owner's families at its revision from one sync, with no copy kept, each record in the family its schema names at any version: the named owner's, `not-found` when it does not serve every named family and `unavailable` when it is down, or else the one owner of every named family, and families of more than one owner `invalid-request` with text that says to name one module's families or the owner; `GET /api/v2/modules`; `GET /api/v2/modules/<name>/settings`; `GET /api/v2/links`, the editor links and the place links; and each module's pages and content. The snapshot route SHALL be the gateway's one-off sync, the second implementation of ADR 0012's snapshot read API, for a caller of this one process. It SHALL answer `GET /api/v2/authority?scope=<scope>` for any caller, 200 when it holds the scope and `forbidden` otherwise. Every document SHALL carry `schema` `<family>/2.0`. A module SHALL count as a family's owner, serving or down, only once it has served that family; this is a known limit: a module that never served, refused at admission or failed in its start before it first served, is not counted, so a combined read such as `GET /api/v2/families/device` answers the other owners with `unavailable` empty, and a family only that module would serve reads `not-found`. A reader such as the dashboard therefore cross-checks each module's state in `GET /api/v2/modules`.

A module's pages, content, settings and tools SHALL be every reader's, and the module list SHALL show them once the module is admitted. A module's contribution SHALL be called only while the module runs (otherwise `unavailable`) and SHALL be answered within 5 s (otherwise `unavailable`). An exception that escapes it SHALL fail the module, as one from a handler does, and be answered `internal`. A passive page SHALL be served in a document whose policy allows no script, frame, form or base and only images and styles from the runtime itself; interactive presentations SHALL follow the trusted frontend requirement below; content SHALL be an image, plain text or JSON of at most 16 MiB; and a page, settings, content of any type, its bytes searched, or tool answer that holds a secret a module read, a tool's refusal included, SHALL never be served (`internal`).

The gateway SHALL serve the dashboard's page and its two assets (Hub #922) on the old Hub's paths, `GET /`, `/dashboard.js` and `/dashboard.css`, from the build's `dist/dashboard/`, without a session, since the page holds no secret and signs in through the browser routes. Each SHALL load from this origin's own pages, a bookmark or the launcher, with no other site's `Origin` or fetch metadata, and `/` also from a link on another local app's page with the same host name: a same-site top-level navigation to a document with no `Origin` (Hub #561). Another site's page, a frame or fetch from another local app, and any of them for an asset SHALL be refused with `forbidden`, another method with `not-found` and a query with `invalid-request`, each logged as `runtime.edge.refused` with the path as its `http.route`; a runtime whose dashboard is not built SHALL answer `not-found`. Each answer SHALL refuse framing, send `Cross-Origin-Opener-Policy: same-origin`, and carry a policy that runs only the page's own script and style and connects only to this origin.

`/mcp` SHALL serve MCP through `packages/mcp`, unchanged, only when the edge section sets `mcp` true, as the old Hub served it only with its `mcp` set, and SHALL otherwise answer `not-found`. It SHALL serve client credentials only, telling a browser session so with `forbidden` before anything else: each module's read tools, as `<module>_<tool>`, to a credential with `read`, and `core_recover_approval` and `core_send_command` (see "Action routes") to one with `control`. A tool's result SHALL be `{result}` and a refusal the shared error body, both under the package's `extension` data. The refusals `packages/mcp` makes itself before a tool runs SHALL keep its released 1.x `gateway-error` result, with the registry's code and no detail: an exception to the shared error body, since the package is reused unchanged. MCP protocol errors SHALL keep the MCP specification.

The gateway SHALL continue authenticated, owned and validated context for the dashboard's five sign-in/read handoffs only, with bounded server spans through the runtime recorder. It SHALL ignore malformed or untrusted parents and SHALL never record a cookie, launch code, request body or exception text in those spans.

#### Scenario: MCP by scope
- **WHEN** an operator, a reader and a hook list MCP tools, the reader calls `core_recover_approval`, and the operator calls `sign_status` and `core_recover_approval` for an unknown session, an unknown tool, and with an `Origin`
- **THEN** the operator sees `core_recover_approval`, `core_send_command`, `core_sessions` and `sign_status`, the reader the two read tools, the hook none; the reader's recovery never reaches the core; `sign_status` answers its result, the recovery the core's `not-found` in the shared error body, the unknown tool an MCP protocol error, and the request with an `Origin` `forbidden`

#### Scenario: MCP off, and a browser session on it
- **WHEN** `/mcp` is called with the edge section's `mcp` unset, and with it set by a browser session without the request header
- **THEN** the first answers `not-found`, and the second `forbidden`, saying the route takes a client credential

#### Scenario: Contributions and their failures
- **WHEN** a module's page throws, a module's settings, text content, JSON content, image content and tools answer with a secret it read, one tool refusing with it in its detail and one answering `{"error": null}`, its content has a type the gateway does not serve, and its family's owner refuses a sync with the secret in its detail
- **THEN** the page answers `internal` and its module fails while the core runs, a later request to it is `unavailable`, the settings, contents and tool answers are `internal`, the odd content is `internal`, the family and snapshot reads answer the owner's code without its detail, and the secret appears in no answer or record

#### Scenario: Owners that cannot answer
- **WHEN** three device modules serve `device`, one refuses its syncs, then a second fails, and then the third fails too
- **THEN** the family reads the first two's records with `unavailable` naming the refusing module, then the first's with `unavailable` naming the refusing and the failed modules and the failed module's snapshot `unavailable`, and at last the read is `unavailable`, never serving an owner's detail

#### Scenario: A family that two modules serve
- **WHEN** the lamp and the sign both serve `device`, a reader reads the family, and snapshots of it name no owner, the lamp, the sign with `sign` beside it, an owner that serves no device, an owner that does not serve `session`, a malformed owner and two owners
- **THEN** the family reads as both devices with no owner `unavailable`; the unnamed snapshot is `invalid-request` saying to name the owner; the lamp's holds the lamp, the sign's the sign in both families; the others are `not-found`, `not-found`, `invalid-request` and `invalid-request`, quoting nothing they were given

#### Scenario: A page that loads its preview by reference
- **WHEN** a reader opens the sign's page and its preview, its settings and the links
- **THEN** the page refers to `content/preview.png` under a policy with `default-src 'none'`, `frame-ancestors 'self'` and `form-action 'none'`; only module page HTML permits same-origin shell framing, with `SAMEORIGIN`, while content responses retain their original framing policy, the preview is a PNG, the settings show the greeting and signs without the token, and the links hold the sign's editor link and the place links

#### Scenario: A stalled reader
- **WHEN** a reader subscribes to large state messages and stops reading until its socket fills, and the stall limit passes
- **THEN** the gateway's edge ends the stream and logs `runtime.edge.disconnected` at WARN with `capacity` and its reason

#### Scenario: The dashboard's page
- **WHEN** a bookmark, the launcher, this origin's page and a page on the other loopback name load `/` and its assets, another local app's link, frame and fetch reach `/`, that link asks for an asset, another site's page or a link with an `Origin` asks for `/`, `/` is posted to or carries a query, and a runtime whose dashboard is not built is asked
- **THEN** the loads and the link are served without a cookie under the page's policy; the frame, the fetch, the asset, the other site and the `Origin` are `forbidden`, the post `not-found` and the query `invalid-request`, logged by route without the query; and the unbuilt runtime answers `not-found` on all three paths

#### Scenario: The dashboard's authenticated HTTP context
- **WHEN** browser session creation, launch exchange, logout, authority or Places reads carry W3C context, including malformed context and requests that fail their boundary checks
- **THEN** the gateway continues a valid parent only after authentication, ownership and input validation, records a bounded server span for each accepted call and keeps post-admission failures in that trace; absent or malformed context starts a root, untrusted context grants no authority, and an unauthenticated logout stays harmless without adopting its parent

#### Scenario: Running build identity is authenticated
- **WHEN** an authenticated reader requests `/api/v2/build`, an anonymous caller requests it and a caller attempts to post to it
- **THEN** the reader gets only the frozen build version, revision, dirty flag and timestamp, the anonymous caller is refused, and the write is not found; the route performs no Git operation

## ADDED Requirements

### Requirement: Bounded queried content reads
The existing authenticated content route SHALL pass query values to API 1.3 modules, allowing at most 16 distinct keys of at most 64 characters and values of at most 512 characters. Older modules SHALL continue to reject queries. The module SHALL validate its own closed query set. Expected content refusals SHALL preserve only a valid shared error code with fixed gateway detail; invalid or secret-bearing replies SHALL remain `internal`. The supplied abort signal SHALL end when the read finishes or exceeds the existing contribution deadline. Existing content MIME, response-size, Origin, running-module and secret-exclusion checks SHALL remain in force.

#### Scenario: Bounded paging parameters and safe refusals
- **WHEN** a reader requests a modern content reference with valid parameters, repeated or excessive query keys, or a query on a legacy module
- **THEN** valid parameters reach the running owner and the other inputs are refused before calling it; a returned domain error does not fail the module or expose its supplied detail

### Requirement: Trusted frontend serving and browser build
The runtime SHALL compile explicitly declared browser frontend entries from the fixed shipped modules into the shared dashboard without importing Node-side module registrations, storage or device transports. The authenticated catalog SHALL identify each declared page's presentation. Component-page URLs SHALL lead to the canonical same-origin shell page without running a renderer or command. Trusted editor HTML and finite declared assets SHALL require read authority and retain Origin, running-module, deadline, bounded response, secret exclusion, no-store and nosniff protections. Executable assets SHALL be resolved by declaration identity, never a client-selected filesystem path. User content SHALL remain on the non-executable content route.

A trusted editor's policy SHALL allow its reviewed same-origin scripts, styles and authenticated reads, and framing by the shell. It SHALL refuse external scripts, eval, inline script handlers, forms, base URLs and nested frames. Its frame SHALL be treated as trusted application code. Passive page and shell framing protections SHALL remain distinct. Unknown assets SHALL be `not-found`, unavailable modules `unavailable`, and invalid or secret-bearing asset responses `internal`, using fixed shared error text. Reads SHALL cause no device or library mutation.

#### Scenario: A trusted editor loads its declared bundle
- **WHEN** an authenticated reader opens a declared trusted editor and its declared assets
- **THEN** the bundle can run within the shell under its declared policy, while a passive page still cannot run scripts and an undeclared executable reference is refused

#### Scenario: Browser build excludes server code
- **WHEN** the shipped frontend entries are bundled for the browser
- **THEN** no Node module registration, database or device transport implementation is included, and a negative control that imports a Node-side entry fails the browser check

#### Scenario: Existing command authority remains decisive
- **WHEN** a read-only or ended session attempts an edit from a trusted page
- **THEN** the authenticated command boundary refuses it before effects; executable page access grants no control authority
