# Linux hub host

This application implements the source scope of [Hub #5](https://github.com/jimmie-potts/agent-device-hub/issues/5). It targets Node 24 on Linux in WSL. Native Windows qualification is outside scope. Routine upgrades follow the [standing installation authority](../../AGENTS.md#runtime-and-migration-boundaries) and named-owner procedure; new installations and live migrations need their own scope.

The host supplies private SQLite ownership, the shared agent-state engine, authenticated loopback monitor routes, bounded controller clients and both delivered integration extensions. Supervised migration transfers state into a fenced destination, verifies routes, then opens ingestion. The [setup runbook](SETUP.md) covers reversible producer setup and Nanoleaf cutover from #8. Installed-client and full integrated performance qualification remain separate.

## Verification runs

[`verify/`](verify/README.md) holds the Hub adapter for disposable
[app verification runs](../../docs/app-verification.md): `npm run -s verify --
<operation>` starts this hub and the dashboard with fake controllers under a
leased user unit, drives the steps in its feature map, keeps frozen proof and
hands over an expiring preview. It is repository tooling and is not part of
the hub package.

## Configuration and authority

The source entry point is `node apps/hub/dist/cli.js serve /absolute/private/config.json` after `npm ci` and `npm run build`. Starting an installed service follows the [installation authority and procedure](SETUP.md#upgrade-and-roll-back-the-installed-hub). Tests use ephemeral disposable state instead.

Configuration is an owner-only regular JSON file with required `directory`, `ownerId`, `consumers`, `credentials`, `controllers` and `port`, plus optional boolean `mcp`, optional `codexDesktop`, optional [`playback`](#playback), optional [`wispr`](#private-wispr-aggregates) and optional [`browserAccess`](#open-bunny-from-a-bookmark). The directory must already exist with mode 0700, outside a source checkout and outside `/mnt`. It belongs exclusively to this host. Normal startup refuses a persisted quiesce fence. `serve-staged` reopens it read-only for recovery; it cannot activate that old attempt. No automatic restart or fallback clears a fence.

Optional `codexDesktop` is `{home, hostId, sourceId}`. `home` is the absolute, normalized Codex Desktop home, such as the Windows Codex home under `/mnt/c`. `hostId` and `sourceId` match the Desktop producer's source. The host then polls Desktop's unread marker read-only every two seconds and records `read.observed` for that source's top-level sessions. The [provider qualification](../../docs/provider-qualification.md#codex-desktop-read-marker) records the marker and read rule. The host never writes Codex files and never returns the path or marker contents. An unusable marker produces no read evidence.

Consumer policies use the shared core's `{id,clearOnNewTurn}` contract and must match persisted/imported state. [Credentials](#credentials) describes the `credentials` list, how to create an entry and what each grant allows. Native controller tokens remain only in private server configuration. No route returns them.

Each controller has `id`, `kind` of `pixoo`, `nanoleaf`, `tidbyt` or `lifx`, `controllerId`, `deviceId`, numeric IPv4 loopback `endpoint` ending `/controller/v1`, and its dedicated `token`. Tidbyt and LIFX devices are served by the [local controller host](../local-controllers/README.md); register each device as its own entry, with the host's endpoint and a token it accepts for that device. There is at most one active HTTP request per device and no automatic retry. A capacity rejection does not reserve a controller ticket. Explicit commands retain the owning controller's request ID and revision guards. A timeout after submission is uncertain, never proof of no effects. `sent` is transport evidence only. To connect an installed Pixoo or Nanoleaf controller, follow [Connect device controllers for B.U.N.N.Y.](SETUP.md#connect-device-controllers-for-bunny).

## Opt-in shared diagnostics

An in-process host can supply `HubOptions.diagnostics`, created by the packaged
`@jimmie-potts/hub/diagnostics` adapter. The host supplies a neutral resource,
a bounded canonical emitter and its tracer. The adapter imports no SDK or
exporter and normal library startup does not construct one. With no adapter,
command behavior is unchanged. Existing injected adapters keep automatic propagation
under their host owner; only the normal CLI adapter selects `propagate: true` for
manual controller headers. Do not combine that option with automatic propagation.

The controller command route adopts validated trace context only after
authentication. It emits canonical request records and controller-client
observations with validated ticket metadata; it never records request bodies,
credentials or exception text. Telemetry errors preserve domain results and
never retry a command. Pilot qualification and broader adoption remain separate
from these source checks; see [the development checks](../../docs/development.md#shared-observability-pilot-checks).

Normal CLI configuration can add `"observability": {"enabled": true}` for canonical
INFO-and-above NDJSON on stderr. Readiness and command-result stdout stays unchanged.
To export to an already running local development Collector and enable traces:

```json
"observability": {
  "enabled": true,
  "collectorOrigin": "http://127.0.0.1:4318",
  "tracing": true,
  "samplingRatio": 0.1
}
```

The origin must be an explicit numeric loopback HTTP origin. Export is optional;
tracing requires it. Sampling defaults to 10% for new root traces and honors
qualified parent sampling. Use `1` for a synthetic correlation check. Set
`enabled` to false or remove the field to disable new diagnostics. Apply these
settings only through a separately authorized installation/configuration change;
source delivery does not edit an installed configuration or start a Collector.

Coverage includes lifecycle/startup errors, authenticated HTTP outcomes,
controller command observations, MCP tool outcomes and commit-triggered feed
fan-out. Command and MCP spans correlate to available controller spans. Validated traceparent
is sent only to the configured authenticated controller endpoint; no baggage or
tracestate is sent. Device/vendor calls remain outside this propagation. Ordinary
HTTP summaries are logs, not a claim that every route has a trace. Feed work
without an active parent starts its own trace. Periodic heartbeat polling,
browser/hooks/helpers, other controllers and per-frame work remain outside this
slice. No raw URLs, request bodies or exceptions are recorded. Use the existing
[pilot query examples](../../docs/development.md#shared-observability-pilot-checks)
with service `hub`, scope, operation, ticket and available trace ID. Logs with an
unsampled flag need not have a stored span. Queue/drop/export counters are exposed
by the injected runtime's `counts()` for host diagnostics/tests.

## Credentials

Every authenticated request carries a bearer token in `Authorization: Bearer <token>`. The hub stores only each token's SHA-256 digest, in the `credentials` list of the private configuration, together with what that token may do:

```json
{"id": "kitchen-display", "digest": "<64 lowercase hex characters>", "scopes": ["read"], "devices": ["ht-a9"]}
```

- `id`: a neutral name for the client, 1-128 characters from `A-Z`, `a-z`, `0-9`, `_`, `.` and `-`, unique in the file.
- `digest`: the SHA-256 of the token as 64 lowercase hex characters, unique in the file.
- `scopes`: up to four of `read`, `ingest`, `control` and `admin`.
- `devices`: up to 16 controller aliases or playback source IDs the token may use. The hub does not check that these exist, so a misspelled entry grants nothing and the route answers 403.

The file holds between 1 and 32 credentials. The hub reads them at startup, and again only when a setup grant or revoke rewrites the list and replaces the running set; that also applies any hand edits waiting in the file. Give each client its own token so you can revoke one without touching the others.

### Create a credential

Run these as the Linux user that owns the hub. The token is 32 random bytes in base64url, exactly 43 characters.

```bash
umask 077
node -e "process.stdout.write(require('node:crypto').randomBytes(32).toString('base64url'))" > /absolute/private/client-token
sha256sum < /absolute/private/client-token | cut -d' ' -f1
```

1. Keep the token file owner-only, outside Git and outside `/mnt`, and give the token only to the client that needs it.
2. Add an entry to `credentials` with the printed digest and the scopes and `devices` from the tables below.
3. Restart the hub so it reads the new list. For an installed systemd user service, run `systemctl --user restart <unit>`. An invalid list, such as a duplicate `id` or `digest`, an uppercase or wrong-length digest, an unknown scope or too many entries, stops startup and takes every client offline, so keep a copy of the previous file to restore. The service log names a stable cause without paths or values, such as `hub-start-failed: invalid-credentials` for this list, or `hub-start-failed: mcp-tool-catalog-too-large` when enabled MCP would publish a tool catalog over its response limit.
4. Check the grant: `curl -H "Authorization: Bearer $(cat /absolute/private/client-token)" "http://127.0.0.1:<port>/api/hub/v1/authority?scope=read"` returns the owner ID for a token with `read` scope, 403 for a known token without it and 401 for an unknown token.

To rotate a token without a gap for that client, create the new credential with a new `id` as above, including the restart and the step 4 check. Then switch the client to the new token, remove the old entry and restart again. To revoke a token, remove its entry and restart; its requests then get 401. Entries named `hub-<hex>` are producer credentials owned by the [setup operations](SETUP.md#credentials-and-windows-invocation). Grant and revoke those through the setup operations instead of editing them by hand.

### What each grant allows

A REST request without a valid token gets 401. A valid token without the needed scope or `devices` entry gets 403. REST requests must also use the numeric loopback address the hub listens on, and every REST mutation needs `X-Pixoo-Request: 1`.

| REST route | Scope | `devices` entry |
| --- | --- | --- |
| `GET /api/monitor/v1/sessions`, `GET /api/monitor/v1/changes`, `GET /api/hub/v1/health`, `GET /api/dashboard/v1/context` | `read` | none |
| `POST /api/monitor/v1/events` | `ingest` | none |
| `POST /api/monitor/v1/commands` to label, acknowledge or recover an approval | `control` | none |
| `POST /api/monitor/v1/commands` to quiesce | `control` and `admin` | none |
| `GET /api/hub/v1/authority?scope=<scope>` | the named scope: `read`, `control` or `ingest` | none |
| `GET /api/controllers/v1/:id/snapshot`, `GET .../integration/snapshot`, `GET .../integration/geometry`, `GET .../integration/receipt`, `GET .../lighting/snapshot` | `read` | the controller alias `:id` |
| `POST /api/controllers/v1/:id/commands`, `POST .../moment`, `POST .../integration/commands`, `POST .../integration/cancel`, `POST .../lighting/commands` | `control` | the controller alias `:id` |
| `GET /api/playback/v1/snapshot` | `read` | the playback ID |
| `POST /api/playback/v1/commands` | `control` | the `sourceId` named in the body |
| `POST /api/dashboard/v1/logout` | `control` | none |
| `GET /api/automation/v1/rules`, `GET .../rules/:id`, `GET .../interrupt-set`, `GET .../settings`, `GET .../log` | `read` | none |
| `POST /api/automation/v1/rules`, `PUT .../rules/:id`, `POST .../rules/:id/enable` | `control` | every alias in the rule's `targets` |
| `POST .../rules/:id/disable`, `DELETE .../rules/:id`, `PUT .../interrupt-set`, `PUT .../settings` | `control` | none |

`GET /api/dashboard/v1/context` lists only the controllers in the caller's `devices`, and adds `"playback": {"sourceId": "..."}` only when those `devices` include the configured playback source. The page and its assets (`/`, `/dashboard.js`, `/dashboard.css`) need no token, and `POST /api/dashboard/v1/launch` takes a one-time launcher code instead. With [`browserAccess`](#open-bunny-from-a-bookmark) set, `POST /api/dashboard/v1/session` signs the page in without a code.

When `mcp` is enabled, `/mcp` accepts configured tokens only. It uses the `read` and `control` scopes, ignores `ingest` and `admin`, and needs no `X-Pixoo-Request` header. A missing or unknown token gets HTTP 401. A tool the token's scopes or `devices` do not cover is left out of the tool list, and calling it anyway returns a tool error with code `forbidden` rather than HTTP 403. `<prefix>` is the per-device value that `hub_devices` returns.

| MCP tools | Scope | `devices` entry |
| --- | --- | --- |
| `hub_sessions`, `hub_devices` | `read` | none; `hub_devices` lists only the caller's controllers and playback source |
| `hub_label`, `hub_acknowledge`, `hub_recover_approval` | `control` | none |
| `<prefix>_status`, `<prefix>_integration_status`, and `<prefix>_integration_receipt` for Nanoleaf only | `read` | that controller's alias |
| `<prefix>_power_set`, `_brightness_set`, `_mode_set`, `_media_start`, `_media_control`, `_integration_set`, and `_integration_cancel` for Nanoleaf only | `control` | that controller's alias |
| `<prefix>_playback_status` | `read` | the playback source ID |
| `<prefix>_playback_command` | `control` | the playback source ID |

### Typical clients

| Client | `scopes` | `devices` |
| --- | --- | --- |
| Agent hook producer | `ingest` | none; the setup operations create it |
| Display that shows agent sessions, such as Nanoleaf | `read` | none |
| Client that also labels sessions or acknowledges notices, such as the Pixoo facade | `read`, `control` | none |
| Tool that reads and controls one device | `read`, `control` | that controller's alias |
| Now-playing display | `read` | the playback source ID |
| Music controls | `read`, `control` | the playback source ID |
| Supervised migration | `read`, `control`, `admin` | none |

### Browser sessions

The B.U.N.N.Y. launcher (see [Browser frontend](#browser-frontend)) does not use a credential from the file, and neither does the [trusted-loopback sign-in](#open-bunny-from-a-bookmark). Each creates a temporary one with `read` and `control` on every configured controller alias and on the configured playback source for up to eight hours. That session has no `ingest` or `admin` scope, and it cannot authenticate MCP. The token form at `/` instead accepts a configured token, and the page then has exactly that credential's grants.

Each browser session owns its command tickets, its change streams and its retained replay results. Logout, the eight-hour expiry, eviction at the 16-session limit, credential replacement and shutdown all retire a session the same way. Its token and cached requests are refused, its streams close, and its ticket ledger and settled replay results are released. A command the session already submitted keeps running. It is not cancelled or sent again, and its replay entry stays charged until the command settles, then is released once. A retired session's late write, whose body arrives after retirement, is refused before it reaches the owner or a controller. After every browser session retires and its submitted commands settle, the host holds no browser ledger, stream or replay entry. Tickets for configured credentials are unaffected. Disconnecting a dashboard that was opened with a configured token ends no session: that credential keeps its streams, its ticket sequence and its retained results.

## HTTP boundary

All routes authenticate before replay. Host must be `127.0.0.1:<port>` or `localhost:<port>` for the actual listener port, and a supplied Origin must name that same host. MCP accepts only the numeric-loopback host. `Sec-Fetch-Site: cross-site` is refused on every route. `same-site` is refused too, with two exceptions. The dashboard page at `/` admits it for a top-level document navigation only; see [Open B.U.N.N.Y. from another local app](#open-bunny-from-another-local-app). `/mcp` admits it, but only with no Origin or the hub's own Origin. Mutations require `X-Pixoo-Request: 1`. There is no CORS grant or raw URL/protocol proxy.

| Route | Behavior |
| --- | --- |
| `GET /api/monitor/v1/sessions` | Selected-owner envelope; `matches` only with a search filter; optional `q` up to 120 characters and `provider`. Its `nextRequestId` belongs to the principal that read it |
| `POST /api/monitor/v1/events` | Shared lifecycle event, maximum 2048 bytes, ingest scope |
| `POST /api/monitor/v1/commands` | Label, exact notice acknowledgment, explicit approval recovery or quiesce, using the latest server-issued request ID. The ID is per principal: a command sent with a different credential than the one that read the sessions gets 410 `request-expired`, even moments later. Read the sessions and send the command with the same token |
| `GET /api/monitor/v1/changes` | Bounded SSE notifications pushed as each revision commits, plus a 1-second heartbeat and resync; fetch a current sessions snapshot rather than replaying effects |
| `GET /api/hub/v1/health` | Shared collector health and separate controller status, without refreshing device observations |
| `GET /api/controllers/v1/:id/snapshot` | Validated owner snapshot for an authorized registered alias, in the 1.0 shape. `?apiVersion=1.1` returns the 1.1 snapshot, with `capabilities.moments` and `state.moment`, from an owner that serves controller contract 1.1 and the 1.0 snapshot from one that does not; see [Controller contract versions](#controller-contract-versions). Another value, a repeated `apiVersion` or another parameter answers 400 `invalid-request` |
| `POST /api/controllers/v1/:id/commands` | Validated controller v1 command and its original receipt/status |
| `POST /api/controllers/v1/:id/moment` | The owner's explicit moment for this device ([Hub #336](https://github.com/jimmie-potts/agent-device-hub/issues/336)); see [Owner moment route](#owner-moment-route) |
| `GET /api/controllers/v1/:id/integration/snapshot` | Validated Nanoleaf or Pixoo settings snapshot |
| `GET /api/controllers/v1/:id/integration/geometry` | Validated Nanoleaf element geometry for the alias's device: saved elements, their zones and display points, and the Lines' connector graph. `nanoleaf` aliases only; an owner without the route answers 422 `unsupported-capability` |
| `POST /api/controllers/v1/:id/integration/commands` | Owning versioned settings request |
| `GET /api/controllers/v1/:id/integration/receipt?epoch=...&sequence=...` | Nanoleaf extension receipt, without issuing another command |
| `POST /api/controllers/v1/:id/integration/cancel` | Nanoleaf extension cancellation request; cannot undo an applied edit |
| `GET /api/controllers/v1/:id/lighting/snapshot` | Validated LIFX lighting snapshot: `lifx-light` 1.0.0 profile, the controller v1 snapshot and the lighting section. `lifx` aliases only; other kinds answer 422 |
| `POST /api/controllers/v1/:id/lighting/commands` | One strict `lifx-light` 1.0.0 color or color-temperature request and its controller v1 receipt. `lifx` aliases only |
| `GET /api/playback/v1/snapshot` | The presented playback source's snapshot; see [Playback](#playback) |
| `POST /api/playback/v1/commands` | One playback command to the presented source and its receipt |

Integration routes answer 422 `unsupported-capability` for `tidbyt` and `lifx` aliases without contacting the owner.

Global HTTP admission is 32, streams 16, connections 64, headers 8192 bytes, command bodies 65536 bytes and requests three seconds. Replay retains at most 256 entries and 262144 fingerprint bytes across principals; pending entries cannot be evicted. Repeated quiesce tickets share one immutable export. Native controller calls have a two-second deadline and one MiB response limit. Slow streams disconnect after five seconds of backpressure. Credential replacement closes streams, retires every browser session and removed credential's tickets, and reauthorizes future requests before replay. Restart changes the command epoch.

### Controller contract versions

The hub reads each registered controller at controller contract 1.1 where the controller serves it, and at 1.0 where it does not ([Hub #576](https://github.com/jimmie-potts/agent-device-hub/issues/576)).

Only a read that asks for 1.1 negotiates: the per-device MCP `status` tool and `GET /api/controllers/v1/:id/snapshot?apiVersion=1.1`, which the dashboard's device reads use since [Hub #336](https://github.com/jimmie-potts/agent-device-hub/issues/336). The hub sends `apiVersion=1.1` and validates the answer against the schema of the version it declares. A 400 `invalid-request` answer means the controller serves only 1.0, as the Nanoleaf controller and the local controller host do today. The hub then reads again without the parameter and remembers a `1.0-only` verdict for the controller epoch of that answer.

- Later reads in the same epoch send no version parameter. A new epoch probes again, and a hub start holds no verdict.
- A timeout, a 5xx answer or a malformed answer never creates or changes a verdict.
- Every other reader keeps the 1.0 shape and sends no parameter. That includes the route without a parameter.
- Reads and negotiation never send a command. [Automation rules](#automation-rules) read their targets through this negotiated read.

### Moment sender

`sendMoment(client, moment)` in `src/moment-sender.ts` sends one contract 1.1 moment to one device ([Hub #335](https://github.com/jimmie-potts/agent-device-hub/issues/335)). It is an internal module with no route, MCP tool, page or stored state of its own, and it applies no policy: rules, routines, agent proposals and the owner's own sends arbitrate before they call it. To reach several devices, a caller computes one start with `hubMonotonicNow()`, passes it as `startAtHubMs` to one call per device and waits for all of them, for example with `Promise.allSettled`.

One call:

1. Waits at most 2.5 s for the controller's one slot. Only sends wait; reads keep the immediate `capacity` rejection.
2. Reads a fresh snapshot through the negotiated 1.1 read in the same slot.
3. Sends nothing unless the snapshot is 1.1 and declares `moments` supported with the mood and a long enough `maxDurationMs`.
4. Builds one `requestV1_1` from the snapshot's ticket, revision and generation. `start.epoch` is the controller's clock epoch and `start.atMs` is `sampledAtMs` plus the hub time from the snapshot's arrival to `startAtHubMs`, which defaults to that arrival. `toleranceMs` defaults to 10,000.
5. POSTs it once and never resends it.

The result is the controller's `receiptV1_1`, a not-sent reason (`1.0-only`, `moments-unsupported`, `unsupported-capability`, `capacity` or `unavailable`) or `uncertain`. Each result carries the `momentId` and the computed start, which is null only when no snapshot was read. A typed controller refusal without a receipt is not sent and keeps the controller's code in `failure`. Invalid input, such as a flourish with `coversStatus:true` or a start more than 60 s ahead, throws `invalid-request` before any read.

Only the POST runs after the start is computed, so the slot wait and the read never use up the device's start window. A call can take about 8.5 s in the worst case (the wait, two 2 s reads and a 2 s POST), which is longer than the hub's 3 s HTTP response bound; a caller behind a route needs its own bound.

### Owner moment route

`POST /api/controllers/v1/:id/moment` lets the owner try a moment on one device from its B.U.N.N.Y. page ([Hub #336](https://github.com/jimmie-potts/agent-device-hub/issues/336)). It needs `control` scope for the alias, the same origin checks as the other controller routes and `X-Pixoo-Request: 1`. The body is exactly `{"mood": "celebrate", "durationMs": 10000, "coversStatus": true}`: a contract mood ID, an integer from 1,000 to 300,000 ms and a boolean. Anything else, a query string or an unknown alias is refused before any controller contact, with 400 `invalid-request` for a bad body.

The hub assigns a fresh `momentId` (`bunny-<uuid>`) and `priorityClass: "event"`, uses the sender's default start and tolerance and calls the sender once. It applies no arbitration, because the owner chose this moment; the device's own precedence still applies. There is no MCP tool for it: agent proposals go through arbitration (#295).

The answer is 200 with the sender's typed result: `{kind:"receipt"}`, `{kind:"not-sent", reason}` (an undeclared mood or a duration above the device limit is `unsupported-capability`) or `{kind:"uncertain"}`, each with the `momentId` and start. One sender call can take about 8.5 s, longer than the hub's 3 s response cap, so the route waits at most 2.5 s from the request's arrival. If the sender has not returned by then, the answer is `{kind:"uncertain", momentId, start:null}`. The one call still finishes on its own, and nothing resends it.

## Automation rules

The hub stores owner-approved event rules and turns matching events into arbitrated moments, without an open conversation or a model call ([Hub #358](https://github.com/jimmie-potts/agent-device-hub/issues/358), [ADR 0006](../../docs/decisions/0006-hub-moments-and-interludes.md)). Rules, the interrupt set, the settings and the automation log live in the hub's private store under the owner lease. They do not move with a released-state migration.

A moment that passes arbitration reaches each target through the [moment sender](#moment-sender), so a device receives it only when its controller serves contract 1.1 and declares `moments`. No rule exists until the owner creates one.

### Rules

A rule is `{name, kind:"event", enabled?, trigger, action}`:

- `name`: display text of up to 80 characters. Text that looks like a credential is refused.
- `trigger`: `{source, kind, alias?}`. `source` is a lowercase source name such as `github` or `agent-lifecycle`. `kind` is a lowercase dotted event kind such as `pull-request.merged`. `alias` narrows the rule to one source alias.
- `action`: `{mood, priorityClass, durationMs, palette?, targets}`. `priorityClass` is `event` or `flourish`. `durationMs` runs from 1,000 to 300,000. `palette` holds 1 to 8 `#rrggbb` colors. `targets` lists 1 to 16 registered controller aliases.

The hub assigns `id` (`rule-<uuid>`) and the `createdAtMs` and `updatedAtMs` times. `enabled` defaults to `false`. `PUT .../rules/:id` replaces the definition and keeps `enabled`; `enable` and `disable` take the body `{}`. The hub holds at most 64 rules and answers 429 `capacity` beyond that. `kind:"routine"` is reserved for [#359](https://github.com/jimmie-potts/agent-device-hub/issues/359). Only these routes store a rule as given; any other creator's rule is stored disabled.

Invalid input answers 400 with `invalid-rule`, `invalid-trigger`, `invalid-action`, `unknown-target`, `invalid-interrupt-set` or `invalid-settings`, and a missing rule answers 404 `unknown-rule`. A staged migration destination answers writes with 503 `owner-quiesced`.

### Interrupt set and settings

`PUT .../interrupt-set` takes `{kinds:[...]}`, up to 64 event kinds. A moment may cover status presentation (`coversStatus:true`) only when its class is `event` and its event kind is in this set. The first start seeds `pull-request.merged`, `ci.failed` and `meeting.reminder`, once. An owner edit, including an empty set, is never re-seeded.

`PUT .../settings` replaces `{noFlourishes, quietHours:{enabled, start, end, timeZone}, budgets:{perAgentTask, perAgentHour, globalHour, deviceSpacingMs}}`. A window whose end precedes its start crosses midnight, and equal start and end cover the whole day. The seeded defaults are flourishes allowed, quiet hours off (`22:00` to `07:00`, host time zone when `timeZone` is `null`), 1 flourish per agent task, 2 per agent per hour, 6 per hour overall and 300,000 ms between flourishes on one device.

### Events and arbitration

Sources inside the hub call one intake with `{id, source, kind, alias?, agent?, task?, delivery}`. `delivery:"replay"` is dropped before any rule. The source and ID of every accepted event are persisted before evaluation, keeping the newest 10,000, so an ID the same source already submitted is dropped, before or after a restart. Moods, aliases and event IDs in which a word starts with a recognizable token prefix, such as `ghp_`, are refused. The hub's lifecycle ingest is the first source: each newly applied lifecycle event arrives as source `agent-lifecycle` and kind `agent.<lifecycle kind>`, such as `agent.turn.ended`, with neutral IDs only.

An event may also carry `pullRequestTitle` and `meetingTitle` (160 Unicode scalars each) and `repositoryName` (80). These optional display fields pass the shared credential and display-text checks; invalid, empty or overlong values reject the event before its ID is consumed. Unknown fields remain invalid. Titles describe the event in the private log and do not affect matching, identity or sending. Controller contract 1.1 carries no such text, and device-specific rendering remains separately scoped. Prompt, response and transcript capture remains #425.

For each enabled matching rule, the hub checks in order: the no-flourish switch (flourishes only), quiet hours (every class), the per-agent task, per-agent hourly and overall hourly budgets (flourishes only), and then for each target whether it can play moments (`1.0-only` or `moments-unsupported`), the device spacing (flourishes only), a Quiet presentation and an active alert on status presentation. The composed target reader uses the negotiated 1.1 read from [Controller contract versions](#controller-contract-versions). A controller that answers only at 1.0 cannot play moments. The reader maps the desired mode (Work and Monitor are status, Free and Media content, Quiet quiet). It treats outstanding attention in the hub's agent state as an active alert. Unknown evidence never blocks at the hub; the device still applies its own precedence. Accepted events are evaluated one at a time from a queue of 32.

An unblocked moment goes to each target once, concurrently, through `sendMoment` with one `hubMonotonicNow()` start instant plus a 1,000 ms lead, and is never retried. Evaluation runs outside every request's response path, so the sender's worst case of about 8.5 s per device never holds an HTTP answer.

### Automation log

`GET .../log?limit=<1-500>&before=<seq>` returns up to `limit` entries (default 100), newest first, with `next` when more may exist. Each entry has the rule ID, the event's source, ID, kind, alias, agent and task, the moment ID, class and `coversStatus`, the target, an outcome and, when the sender computed one, the controller `start`. The outcome is `blocked` with a reason, `receipt` with the receipt's request ID, outcome, prior effects and any failure code, `not-sent` with the sender's reason and any failure code, or `uncertain`. The log keeps the newest 5,000 entries and holds no credentials or tokens.

When the source supplies valid display metadata, the entry's `event` also includes its `pullRequestTitle`, `repositoryName` and/or `meetingTitle`, including for blocked moments. The existing JSON detail stores only these declared fields beside sender evidence, under the same private owner lease. Earlier log rows remain readable and omit the fields; no names are inferred or backfilled.

## Playback

[Hub #175](https://github.com/jimmie-potts/agent-device-hub/issues/175) added shared playback with the Sony HT-A9 as its first source, and [#233](https://github.com/jimmie-potts/agent-device-hub/issues/233) added the Sonos Move as the second. The owner's iPhone plays Apple Music over AirPlay to one speaker or to both as a group; the hub reads what is playing and can send pause, play, next and previous. No audio passes through the hub. The [qualification record](../../docs/iphone-apple-music-qualification.md) documents the speaker behavior this relies on.

### Configuration

```json
"playback": {
  "id": "ht-a9",
  "sources": [
    {"kind": "sonos", "endpoint": "http://192.168.1.30:1400/MediaRenderer/AVTransport/Control"},
    {"kind": "sony", "endpoint": "http://192.168.1.20:10000/sony"}
  ]
}
```

`id` is a neutral label you choose. It is the one playback ID every client sees: the `sourceId` in every snapshot and receipt, the credential device grant, the MCP tool prefix and the dashboard context. It never changes when the hub switches between speakers, so never use a track name or a speaker address. An ID that looks like an IPv4 address or contains a configured endpoint address is rejected. It must differ from every controller alias and from `hub-service`.

`sources` lists one or two speakers in preference order, at most one of each `kind`. Entries have no ID of their own. Each `endpoint` must use a numeric private (10/8, 172.16/12, 192.168/16) or loopback IPv4 address with a port and no credentials, query or fragment:

| `kind` | `endpoint` | Speaker API |
| --- | --- | --- |
| `sony` | exactly `http://<IPv4>:<port>/sony` | Sony Audio Control API, port 10000 |
| `sonos` | exactly `http://<IPv4>:1400/MediaRenderer/AVTransport/Control` | UPnP AVTransport control URL |

Any other shape stops the hub with `invalid-playback`. Keep the addresses in the private configuration file only.

**Upgrading from a single `selected` source.** Hub 0.3.10 and earlier used `{"selected": "ht-a9", "sources": [{"id": "ht-a9", "kind": "sony", ...}]}`. That form is rejected. Rename `selected` to `id`, remove the `id` from the Sony entry and add the Sonos entry first, as above. Keep the same ID, and credentials, the Tidbyt `nowPlaying` block and the Pixoo card need no change.

Credentials need the playback ID in `devices`: `read` scope for snapshots and `control` scope for commands. See [Credentials](#credentials) to create one. Launcher browser sessions receive both, and B.U.N.N.Y. shows the playback under Music ([#37](https://github.com/jimmie-potts/agent-device-hub/issues/37)). The MCP playback tools are described under [Optional local MCP](#optional-local-mcp). The Tidbyt runner's optional now-playing tile ([#38](https://github.com/jimmie-potts/agent-device-hub/issues/38)) is a read-only consumer of the snapshot; see the [Tidbyt guide](../../controllers/tidbyt/README.md#now-playing-decisions).

### Which speaker is shown

The hub polls every configured source and keeps a separate observation and freshness record for each. Every snapshot and command uses the *presented* source: the first source, in configured order, with the highest rank of

1. reporting a session, meaning its retained observation is `playing` or `paused`;
2. freshness, `available` over `stale` over `unavailable`;
3. configured order.

With the Move listed first: the phone playing to the Move alone, or to the Move and the HT-A9 as a group, shows the Move; the phone playing to the HT-A9 alone shows the HT-A9, because the Move reports `inactive`; a Move that stops answering mid-song stays shown as `stale` with its last track for up to 30 seconds, then the HT-A9 is shown. A stopped, inactive or unrecognized state is not a session, so a Move that still shows a stopped AirPlay track does not outrank a playing HT-A9. When nothing is playing, the freshest source is shown, ties going to configured order. The snapshot does not say which speaker is presented, and the ID never changes.

### Snapshot

`GET /api/playback/v1/snapshot` returns:

```json
{"apiVersion": "1.0", "sourceId": "ht-a9", "availability": "available", "observedAtMs": 1790000000000, "ageMs": 850,
 "playback": {"status": "playing", "title": "...", "artist": "...", "album": "...", "controls": ["pause", "next", "previous"]}}
```

`observedAtMs` is the hub's wall-clock time of the presented source's last successful read. `ageMs` is the larger of the monotonic and wall-clock ages, so neither a system clock change nor a suspend can make an old read look fresh. A successful read refreshes both even when nothing changed; a failed read does not.

| `availability` | Age of the presented source's last successful read | `playback` |
| --- | --- | --- |
| `available` | under 5 seconds | last observation |
| `stale` | 5 to under 30 seconds | last observation, kept for context |
| `unavailable` | 30 seconds or more, or no read yet | `null` |

The hub starts `unavailable`. A speaker that stops answering never turns into `paused`. `status` is `playing`, `paused`, `stopped`, `inactive` or `unknown`. `inactive` means the speaker answered but AirPlay is not its current input. `title`, `artist` and `album` are omitted when the speaker does not supply them. Artwork, position, duration and song-change events are not part of this version, because the Tidbyt and Pixoo card parsers reject unknown keys; see [#229](https://github.com/jimmie-potts/agent-device-hub/issues/229), [#38](https://github.com/jimmie-potts/agent-device-hub/issues/38) and [#39](https://github.com/jimmie-potts/agent-device-hub/issues/39).

### Commands

`POST /api/playback/v1/commands` takes exactly `{"requestId": "...", "sourceId": "ht-a9", "action": "pause"}` with `X-Pixoo-Request: 1` and a body of at most 1024 bytes. `requestId` is a client-chosen neutral ID and `sourceId` is the playback ID. `action` is `play`, `pause`, `next` or `previous`, but only actions listed in the presented source's current `controls` are accepted, and only while `availability` is `available`. A stale snapshot still shows its last controls for context. The command goes to the source presented at that moment; if the presented source changed since the client's read and no longer declares the action, the hub answers `unsupported-control` and sends nothing. The Sony source lists pause, next and previous while AirPlay is playing, only next and previous while it is paused, and never lists play, because the HT-A9 cannot resume a paused AirPlay session ([#242](https://github.com/jimmie-potts/agent-device-hub/issues/242)). The Sonos source lists play while paused, so play and resume run through the Move, including for a grouped HT-A9. While playing, previous restarts the current song on both speakers. The owner's 2026-09-25 live check for #37 showed that next and previous change the phone's track while paused without resuming, but the HT-A9 kept reporting the old title, so a paused snapshot's title can lag until playback resumes.

| Result | Meaning |
| --- | --- |
| 200 `sent` | The speaker accepted the call. This is transport evidence, not proof the phone reacted. |
| 502 `failed` | The speaker refused the call. |
| 503 `uncertain` | No usable reply: a timeout after 1.5 seconds, a network error, or a non-200, malformed or mismatched reply. The command may have taken effect. |
| 400 `invalid-input`, 403 `forbidden` | Bad body, missing scope, header or playback grant |
| 404 `unknown-source` | The body names something other than the playback ID |
| 409 `request-conflict` | The request ID was already used with a different body |
| 413 `capacity` | The body is larger than 1024 bytes |
| 422 `unsupported-control` | The action is not in the presented source's current controls |
| 429 `capacity` | Another playback command is still running |
| 503 `source-unavailable`, `owner-quiesced` | The presented source is not `available`, or the host is staged |

Admitted results carry `{requestId, sourceId, action, outcome}`. Repeating a request ID with the same body returns the original receipt without contacting a speaker, so a client retry after a lost response is safe. The hub keeps the latest 64 receipts; a restart clears them. Only one command runs at a time across both sources, nothing is retried automatically and no command is redirected to another source or address.

### Sony source behavior

The Sony module calls `avContent.getPlayingContentInfo` version 1.2 at startup and then every two seconds. Each call has a 1.5-second timeout and a 64 KiB reply limit, and a read already in progress is reused instead of starting another. It uses the entry whose `source` is `extInput:airPlay`, maps `PLAYING`, `PAUSED` and `STOPPED` to the shared statuses and any other state to `unknown`. It trims `title`, `artist` and `albumName` and limits each to 256 characters. Other receiver fields, including the thumbnail URL that embeds the receiver address, are dropped. JSON-RPC errors, non-200 replies, malformed bodies, timeouts and network errors are failed reads. Commands call `pausePlayingContent` 1.1, `setPlayNextContent` 1.0 or `setPlayPreviousContent` 1.0; a JSON-RPC result is `sent` and a JSON-RPC error is `failed`.

### Sonos source behavior

The Sonos module sends three SOAP actions on `InstanceID` 0 to the configured AVTransport control URL at startup and then every two seconds, in sequence: `GetTransportInfo`, `GetPositionInfo` and `GetCurrentTransportActions`. Each call has a 1.5-second timeout and a 64 KiB reply limit, a read already in progress is reused, and any call that does not return HTTP 200 with its response element fails the whole read, which reports nothing. A `TrackURI` with the `x-sonos-vli` scheme is the AirPlay session; any other URI, or none, is `inactive` with no metadata and no controls. `CurrentTransportState` maps `PLAYING`, `PAUSED_PLAYBACK` and `STOPPED` to the shared statuses and any other state, including `TRANSITIONING`, to `unknown`. The DIDL-Lite `TrackMetaData` supplies `dc:title`, `dc:creator` and `upnp:album`, decoded, trimmed and limited to 256 characters; `albumArtURI`, `RelTime` and `TrackDuration` are not copied. Controls intersect the advertised `Actions` with the state: playing declares pause, next and previous, paused declares play, next and previous, and other states declare nothing. Pause, next and previous while playing and play while paused were confirmed on the phone ([qualification record](../../docs/iphone-apple-music-qualification.md#sonos-move-check)); next and previous while paused follow the Move's own action list and were confirmed in the #233 live check. The owner saw the phone change track while paused, while the Move kept reporting the old title until playback resumed, the same metadata lag as the HT-A9. Commands post `Pause`, `Play` with `<Speed>1</Speed>`, `Next` or `Previous` once. HTTP 200 is `sent`, an HTTP 500 carrying a SOAP fault is `failed`, and anything else is `uncertain`.

### Adding a source

`src/playback.ts` is the shared module and imports no source code. It serves one playback ID from the sources in configured order. A source implements `PlaybackSource` and has no ID of its own:

- `start(report)`: begin observing and call `report` with a normalized observation after every successful read, including unchanged ones. Never report a failed read.
- `command(action)`: resolve `sent` when the source accepted the call or `failed` when it refused before any effect. Reject for any uncertain result, and apply your own timeout under the host's three-second request limit.
- `close()`: stop observing and abort in-flight work. If it fails, the other sources still close, the host finishes shutting down and then reports the error.

`src/sony.ts` and `src/sonos.ts` are the two adapters; each validates its own `{kind, endpoint}` entry. `server.ts` validates the `playback` envelope, builds each source for its `kind`, allows one entry per kind and closes every source with the host. A third kind needs a new module and a new branch there. The archived [#233 design](../../openspec/changes/archive/2026-09-25-gh-233-sonos-playback-source/design.md) records the preference rule and why the ID stays stable.

## Compatibility and evidence

| Boundary | Contract and evidence |
| --- | --- |
| Shared state | `@jimmie-potts/agent-state` 3.2.0; lifecycle 1.0, durable export 2.0 (1.0 import), snapshots 1.0/1.1; no second reducer |
| Pixoo remote source | Monitor v1 from source #31; actual facade, producer, browser actions and renderer exercised by `scripts/check-hub-pixoo.mjs` |
| Pixoo native controller | Released controller v1, #37; `pixoo-integration/1.0`, source `28f4875b7a0f0e57ca6f25d9971e125e927a5503`; strict native snapshots/commands and pinned fixtures |
| Nanoleaf native controller | Released controller v1, #28; configured Linux owner |
| Nanoleaf settings | `nanoleaf.integration/1.0`; owning-service check against source `f3c13843f1e5431b01ddca344a91cd7484348f59` (`scripts/check-hub-nanoleaf.mjs`, including the geometry route); request consumer and fixtures vendored from `80628498136203a8f5fcb06ab5fa306e961e2def`, so the hub forwards only the four configuration commands and never `animation.play`; both recorded in `fixtures/nanoleaf-source.json`. A read-only device such as the Panels (codex-nanoleaf#113) marks the four operations `supported: false`, which the closed snapshot validation accepts (#323); its commands still reach the owner, which rejects them |
| Nanoleaf geometry | `nanoleaf.integration/1.0` `GET /geometry` from codex-nanoleaf#169, source `0043456deea4f224dfa39ae1bb9d4f289e77e3d1`; closed `validateIntegrationGeometry` checked against the owner's fixtures copied to `fixtures/nanoleaf-geometry.json` |

Run `npm run test:hub`, `npm run test:hub:package` and all shared checks from the worktree root. The tests use synthetic tokens, private temporary directories, fake loopback controllers and a fake loopback Sony receiver. These checks do not qualify installed clients, physical results, live migration or performance budgets. A database lease prevents concurrent use of that store; it does not by itself prevent a second owner in another directory. The supervised migration path below verifies source-process release, destination and consumer readiness before resuming ingestion.

The source package command is `npm run package:hub`. It creates an archive and SHA-256 sidecar under ignored `artifacts/`. Package verification compares repeated archive bytes, installs offline into a fresh directory, checks file hashes, then runs the installed tests and import check. The dependency closure comes from the exact locally built contract/state archives, including the pinned lifecycle dependency. It does not resolve private packages from a registry.

For a separate synthetic API measurement, run `node scripts/measure-hub.mjs /absolute/new/receipt.json` after building. It starts disposable child hosts for three repetitions of 1,000 ingest/read pairs at 1, 10 and 50 session identities, retains every sample and failure, and checks peak host RSS against the owner-approved 256 MiB service RSS limit. HTTP pair timings are not the legacy full-hook boundary, so the receipt cannot qualify the full integration or replace #30 acceptance.


## Supervised state-owner migration

This is an explicitly called local API, not an HTTP administration endpoint or an installer. It supports direct Node children it starts. Independently supervised services must first be stopped through their named owner and brought under this explicit supervision; an arbitrary PID, unreachable endpoint or operator confirmation string is not release proof. The launcher uses an absolute entrypoint, arguments and an explicit environment without a shell. Do not pass device-mode configuration unless that operation is separately authorized.

1. Call `launchOwner` from `dist/migration.js` with kind `pixoo` or `hub`, the installed Node entrypoint, explicit arguments/environment and the source's private monitor credential. The launcher binds the returned URL to that child's successful startup. A failed launch terminates that exact child and verifies its exit.
2. Call `quiesceAndStop(owner, newPrivateExportPath)`. It validates the versioned export, saves and synchronizes it in a new owner-only file, requests graceful shutdown and verifies exit. It mints one process-local `ReleasedState` capability. Neither exported JSON nor a copied capability can authorize another import.
3. Call `startHub(options, {staged:true, released})` with an empty destination and matching owner ID and consumer policy. Import consumes the capability before asynchronous work. The persisted fence precedes import. Sessions remain readable; ingestion, labels and acknowledgments reject while staged.
4. Use `routeDigest` and `stageProducer` from `dist/migration-routes.js` on each explicitly named private producer file. It preserves source identity, qualification and original enablement while selecting the new endpoint/token and disabling emission. Use `stagePixooSource` on Pixoo's monitor configuration, then restart the same supervised app so its facade loads the selected remote owner. Its media directory and presentation preferences remain owned by Pixoo.
5. Call `hub.activate({producers, consumers})`. Each consumer entry has its configured `id`, staged `route` and live `owner` capability returned by `launchOwner` for Pixoo. Every configured consumer must be represented. The Pixoo adapter handles consumer ID `pixoo` and its selected-source protocol. Readiness is bound to the supervised child, its startup URL/credential and the exact `PIXOO_DATA_DIR/agent-monitor/config.json` bytes loaded at launch; caller-supplied URLs cannot substitute for that facade. For Nanoleaf, first call `hub.prepareConsumers()` while writes remain fenced, then `prepareNanoleaf` from the setup-consumer API and pass `{id:"nanoleaf", nanoleaf}`. See the setup runbook for explicit installation authority and policy prerequisites. Activation checks the destination's ingest/control authority, actual facade owner/revision/session state and unchanged route files. It restores producer enablement while admission is still fenced, then synchronously clears the durable fence and opens admission. No new writes can enter during partial route updates.
6. Release each completed route lock with `releaseRoute`. This removes completed migration intent, never restores an old endpoint or changes producer enablement. Record any cleanup failure separately from the completed activation.

The route coordinator uses an exclusive OS-released SQLite lease in a separate migration file, private durable intent, file preimage checks, atomic replacement and directory synchronization. It does not open controller databases. A second live coordinator is refused. Initial intent is published atomically before the route changes. An interrupted attempt retains its original enablement, including when it explicitly releases its lease. After coordinator death, `recoverRoute(path, currentDigest)` accepts a dead recorded process, or an attempt this process knows failed and released its lease, with the recorded before/after file bytes. It retains original enablement and disables the producer again. `retargetRoute` can select the fresh recovery destination under the same lease. Unexpected edits or incomplete intent require inspection; the tool does not delete an unknown lock.

Any activation failure consumes that attempt's activation permission and leaves admission fenced. Some producer files may already be enabled, but their requests still reject. Restart the destination with `serve-staged`, supervise that process, quiesce/export its current state and migrate into another empty store. Recover route intent before selecting that new destination. Never clear a fence or resume the old embedded store to bypass an uncertain attempt. If a failure happens before destination import, the synchronized export and fenced source remain available for explicit owner-led recovery; no automatic fallback runs.

Rollback after accepted writes uses the same procedure with the current hub as source and a fresh host store as destination. The original Pixoo app remains a remote facade, retaining media and preferences. This tooling does not restore embedded ownership into Pixoo's occupied original monitor store. Every rollback preserves the latest labels, notices, acknowledgment, source identities and revisions of unexpired sessions; the destination expires any session whose last lifecycle evidence is 24 hours old or more at startup. Restarted evidence remains uncertain, and presentation does not resume automatically.

The reproducible package exposes `@jimmie-potts/hub/migration` and `@jimmie-potts/hub/migration-routes` alongside its host API. The source checks exercise disposable state and real owning-service code; they do not migrate a personal installation or establish physical display accuracy.

## Running build identity

Authenticated reads of `/api/hub/v1/health` and `/api/dashboard/v1/context`
include `build: {sourceRevision, version}`. The Hub reads its own packaged
`manifest.json` once at startup. Changing a release link or replacing that file
does not change the running process's identity; restarting loads the target
release's metadata. This build revision is separate from an agent-state
`sourceRevision`.

The package command stamps a full Git commit only when the source checkout is
clean and its commit is available. Dirty or unavailable source provenance is
`unknown`. Missing, unreadable, linked or malformed runtime metadata also yields
`unknown`; the Hub does not inspect Git or infer a build from a current link.
Responses contain no installation paths. Existing read permissions and health
failure status still apply. Connections shows the version and short revision,
with selection and copying of a known full revision.

## Browser frontend

The packaged hub serves B.U.N.N.Y. at `/`, with fixed `/dashboard.js` and
`/dashboard.css` assets and a restrictive same-origin content security policy.
The page sends `frame-ancestors 'none'`, `X-Frame-Options: DENY` and
`Cross-Origin-Opener-Policy: same-origin`, so no page can frame it or keep a
handle to its tab.
`GET /api/dashboard/v1/context` authenticates with read scope and exposes only
that principal's registered component aliases, control permission and configured
monitor consumers, plus the running build identity. Native controller credentials
and endpoint URLs are excluded.

### Open B.U.N.N.Y. without typing a token

Run `node apps/hub/dist/cli.js open /absolute/private/config.json` as the Linux
user that owns the running Hub. The command reads the same owner-only
configuration as `serve`, requests a 30-second one-time code through
`<directory>/bunny-launch.sock`, and opens the Hub loopback URL with that code in
the fragment. On WSL it calls `cmd.exe` to open the Windows browser; on native
Linux it calls `xdg-open`. It prints no token or launch code. A missing browser
opener reports `bunny-open-failed` so the owner can repair the launcher and retry.
This is the command to put in the installation owner's shortcut. A direct visit
to `/` still offers the separately provisioned token form for older workflows.

The page removes the fragment from history before exchanging the code. The
resulting bearer stays in page memory for up to eight hours, with `read` and
`control` on the host's configured aliases and playback source, and no `ingest` or `admin`. The
browser bearer cannot authenticate MCP. Disconnect revokes it; reload discards
it, so use the launcher again. At the 16-session limit, a new launch revokes
the oldest browser session. Existing machine and manual browser credentials
remain configured separately. The private socket is removed on orderly
shutdown. On restart, the host removes an unresponsive socket only when it is
still the same owner-owned socket; a live socket blocks startup. Do not clear
the state-owner database or start a second owner. With
[`browserAccess`](#open-bunny-from-a-bookmark) set, a bookmark replaces the
launcher.

### Open B.U.N.N.Y. from a bookmark

Hub [#276](https://github.com/jimmie-potts/agent-device-hub/issues/276) adds an
opt-in sign-in for the owner's own PC. Add this field to the private
configuration and restart the hub:

```json
"browserAccess": "trusted-loopback"
```

Then bookmark `http://127.0.0.1:8788/` or `http://localhost:8788/`, using the
configured `port`. On load the page posts `{}` to `POST /api/dashboard/v1/session`
and receives the same browser session the launcher issues: `read` and `control`
on configured aliases and the playback source, no `ingest`, `admin` or MCP,
eight hours, and the shared 16-session limit and retirement. There is no cookie
or browser storage. A reload or a new tab signs in again, and a page logs its
session out as it unloads. The route requires the page's Host, a matching
Origin, `Sec-Fetch-Site` absent or `same-origin`, `X-Pixoo-Request: 1` and an empty JSON
object body. Without the field it answers 404, and any other value refuses
startup with `invalid-configuration`. The launcher and token form keep working.

The option removes one protection. Without it, a local program needs a
configured token or the owner-only launch socket to command devices. With it,
any program on the PC that can send a loopback request with the page's Host,
Origin and custom header gets the same read and control. This matches the
Nanoleaf wall map on port 8765. Reassess before any LAN, phone or
second-operator exposure.

If the bookmark shows the login page, the option is off or the hub has not been
restarted since it was added: the session route answers 404. If the page shows
"couldn't sign you in", the hub refused or failed the request; reload,
or use the launcher or token form. After an eviction or the eight-hour expiry,
the dashboard offers **Sign in again**.

This source change does not update the running installation. A named owner
must install a reviewed Hub package, and either wire the launcher shortcut or
add `browserAccess` to its actual private configuration. Browser handoff tests
use disposable stores and fake controllers; they do not qualify a personal
service or device result.

### Open B.U.N.N.Y. from another local app

Hub [#561](https://github.com/jimmie-potts/agent-device-hub/issues/561) lets a
link on another local app's page open B.U.N.N.Y., such as the wall's
**B.U.N.N.Y.** link or a link between a verification preview's pages. Chromium
sends that click as a `same-site` top-level navigation, because only the port
differs. The hub serves `/` for it when the request also has
`Sec-Fetch-Mode: navigate`, `Sec-Fetch-Dest: document`, no Origin and a
loopback Host. With
[`browserAccess`](#open-bunny-from-a-bookmark) set, the new tab signs in as a
bookmark does. Without it, the tab shows the launcher and token login page.

Only the page itself is admitted. `/dashboard.js`, `/dashboard.css`, every API
route, the session route and the launch exchange still refuse same-site
requests, and a frame, fetch or subresource request for the page is refused.
A link from another host name, a guide opened from a file or the public guide
is `cross-site` and is still refused.
[#563](https://github.com/jimmie-potts/agent-device-hub/issues/563) tracks the
guide's link, and
[codex-nanoleaf#199](https://github.com/jimmie-potts/codex-nanoleaf/issues/199)
a wall opened as `localhost`.

Another local program can already open the page through the system browser.
With `browserAccess` set, it can already post to the session route itself.
After this change, a page of such an app can also open the dashboard with a
link. It cannot read, script or frame the dashboard, and sign-in stays the
page's own same-origin request with `X-Pixoo-Request`. The page's
`Cross-Origin-Opener-Policy: same-origin` severs any window handle the linking
page holds. Without it, a hostile local page could re-navigate a window it
opened back to the hub faster than each load's `pagehide` logout, until the
16-session limit evicted the owner's session. What remains: each click or
navigation from such a page opens one signed-in tab. That tab logs out when it
closes, and otherwise counts toward the limit until it expires.

The cross-site refusal covers direct navigations only. Chromium sends a
speculation-rules prefetch of the page with `Sec-Fetch-Site: none`, as it does
for a bookmark, and a later click on the prefetching page's link shows the
prefetched page. So a website can still open a signed-in dashboard when the
owner clicks its link. Each such click opens one signed-in tab, and the opener
policy severs any window handle that page holds. Whether to refuse prefetches
is [#564](https://github.com/jimmie-potts/agent-device-hub/issues/564).

If a link shows `{"error":{"code":"forbidden"}}`, first check that the running
hub includes #561. Then read the navigation's request headers in the browser's
developer tools. `Sec-Fetch-Site: cross-site` means the linking page uses
another host name or scheme, for example the wall opened as `localhost:8765`
linking to `127.0.0.1:8788`. Open both apps under `127.0.0.1`, or use the
bookmark. `Sec-Fetch-Dest: iframe` means a page tried to frame B.U.N.N.Y.,
which stays refused.

Optional `editorLinks` maps registered aliases to credential-free numeric-loopback
HTTP editor links without query/fragment. Optional `placeLinks` (Hub #495) is for
verification previews. It maps a Local Places id other than `bunny` to a
credential-free `http://127.0.0.1:<port>/` URL without query or fragment, with at
most 8 entries, and anything else fails the start with `invalid-place-links`.
The dashboard then shows only those Local destinations. Existing API-only
configurations remain valid. See [the dashboard guide](../dashboard/README.md) for provisioning,
capability-based views and synthetic verification.

## Optional local MCP

Set the optional private configuration field `mcp` to `true` to mount `/mcp` on the same loopback listener. Omitted or false leaves it disabled. This is source configuration support; enabling an installed service still needs separate authorization. The handler reuses `@jimmie-potts/device-mcp` 1.0.1, its pinned SDK and supported protocols, and the host's current machine-credential verifier. MCP does not require the browser mutation header; existing REST protections are unchanged.

`hub_sessions` returns the same qualified snapshot, provider/query matches and next state request ID as the HTTP session route. `hub_label` and `hub_acknowledge` use `request_id` for that exact string ticket and share the HTTP command ledger. No ingest, quiesce, migration or administrative tool is exposed. Read/control scopes apply as on the owning routes; read permission does not grant control. Discovery and reads never acknowledge notices or infer task success.

`hub_devices` lists authorized configured aliases, their kinds and stable `toolPrefix` values without querying controllers. A Pixoo or Nanoleaf prefix binds status, power, brightness, mode, media and integration tools to one configured owner. A Tidbyt prefix binds only `status`, because the Tidbyt controller declares no controller v1 capability. A LIFX prefix binds `status`, `power_set`, `brightness_set`, `lighting_status`, `color_set` (hue 0–360, saturation 0–100) and `temperature_set` (1500–9000 K). The two lighting tools send one `lifx-light` request each and never change power or brightness. Prefixes include a bounded alias segment and SHA-256 suffix so dotted aliases and long IDs remain valid and distinct. The reserved `hub-service` alias represents only global application tools and cannot name a configured controller when MCP is enabled. It is excluded from device discovery. Native controller/device IDs inside results remain unchanged, including when multiple controllers use the same native device ID.

| Suffix | Behavior |
| --- | --- |
| `_status` | Validated native controller v1 snapshot, read at contract 1.1 where the owner serves it (adds `capabilities.moments` and `state.moment`), otherwise at 1.0 |
| `_power_set`, `_brightness_set`, `_mode_set` | Native request ticket, configuration revision and generation guards; unsupported capabilities return the owner's rejection |
| `_media_start` | Forward controller v1 `media.start` with `playlistId` and the same native guards |
| `_media_control` | Forward controller v1 `media.control` with `action` and the same native guards |
| `_integration_status` | Validated Pixoo or Nanoleaf integration snapshot |
| `_integration_set` | Pixoo `request_id`, revision/generation and mode/view action, or Nanoleaf `requestId`, expected revision and declared settings command |
| `_integration_receipt`, `_integration_cancel` | Nanoleaf receipt lookup and explicit cancellation using the original ticket |

All tool results use the reusable module's extension envelope. `data.result` contains the owning snapshot, outcome or receipt. Safe pre-admission errors use `data.code`; ambiguous writes retain `priorEffects: possible`, the original request ID and `retry: never-automatically`. An accepted or applied configuration is not proof of a physical effect. Disconnect and MCP session removal stop response delivery, not admitted owner work.

Media tools take `requestId`, `expectedConfigurationRevision` and
`expectedGeneration` from the latest `_status` result. Select a saved playlist ID
or action advertised by the owner's media capability. Controller v1 actions are
`pause`, `resume`, `stop`, `next`, `previous`, `restart-with-changes` and `clear`;
each owner may support a subset. The owner returns typed rejections for
unsupported operations. Both tools require current control scope and permission
for the configured alias.

When playback is configured, `hub_devices` also returns `playback: {sourceId, toolPrefix}` for a caller whose `devices` include the source. `<prefix>_playback_status` returns the [playback snapshot](#snapshot). `<prefix>_playback_command` takes only `requestId` and `action`; the tool supplies its bound source ID, so a caller cannot name another source or address. Use a new `requestId` for each intended action; repeating one returns the original receipt without contacting the receiver. `data.result` is the receipt plus `priorEffects`: `confirmed-transmission` for `sent`, `none` for a receiver refusal (`failed`) and `possible` for `uncertain`. `failed` and `uncertain` are tool errors. `unsupported-control`, `source-unavailable`, `capacity`, `request-conflict` and `owner-quiesced` return `data.code` with `priorEffects: none`, and nothing retries automatically. A staged hub refuses playback commands, as its HTTP route does.

For Pixoo, first read `_integration_status` and explicitly select Media through
`_integration_set` if necessary; wait for the observed Media mode, then obtain
fresh controller guards. Each media call forwards one command. It does not switch
modes, restore Monitor or start a retry. Pixoo retains its playback and mode
policy. Its catalog and rendition handlers remain in the Pixoo application and
its optional local MCP endpoint remains available independently. These hub tools
only forward the two controller v1 media commands.

`npm run test:hub:mcp` exercises synthetic Codex/Claude protocol profiles for MCP 2025-11-25 and 2025-06-18, scoped discovery, Host/Origin checks, credential replacement, HTTP/MCP replay, native settings, independent controller failure, bounded concurrency, disconnect and stale evidence. The reproducible hub archive bundles MCP and its dependency closure; `npm run test:hub:package` repeats these tests after offline installation. These are source and loopback checks, not installed Codex/Claude, Windows/WSL client routing or physical acceptance. Feed this coverage into Hub #9; installed qualification remains #8 and device-owned acceptance.

### Point a Codex client at `/mcp`

Checked with Codex CLI 0.156. `<name>` is a server name of your choice and `<VAR>` an environment variable that holds a configured token with the `read` and `control` scopes.

- Without a config edit, add `-c mcp_servers.<name>.url="http://127.0.0.1:8788/mcp"` and `-c mcp_servers.<name>.bearer_token_env_var="<VAR>"` to the command, with the token only in that process's environment. The persistent form is `codex mcp add <name> --url <url> --bearer-token-env-var <VAR>`.
- The hub annotates its write tools as destructive. With `approval_policy="never"` Codex refuses them before anything reaches the hub, then reports the result as uncertain. For a non-interactive check, approve only the chosen tool with `-c mcp_servers.<name>.tools.<prefix>_playback_command.approval_mode="approve"`. That tool also needs the playback source in the token's `devices` list.
- `codex exec` waits on stdin. Run it with `< /dev/null`, or it sits at "Reading additional input from stdin..." until killed.

## Session retirement and archive admission

A normalized `runtime.ended` from any supported path (Codex Desktop, Codex CLI or Claude Code) retires the known session tree through the shared owner without Codex-home access. Opening a store written by an older owner retires the records that hold an accepted end as activity `ended`. Other records, including those an older owner left `unknown` after an unordered hook end, keep their clocks and the 24-hour fallback. A store holding a Claude or CLI retirement guard cannot be opened by Hub 0.3.0 through 0.3.3 until a running or reopened 0.3.4 owner has pruned that guard, 24 hours or more after the retirement. The existing `codexDesktop` configuration additionally supplies read-only archive admission evidence for its exact host/source namespace. The host inspects at most 10,000 entries under `archived_sessions` within the owner's 200 ms bound, matching regular `rollout-YYYY-MM-DDTHH-MM-SS-<sessionId>.jsonl` filenames. It does not open transcripts, poll archives, follow an archive-directory symlink, or change Codex files. Missing/unreadable evidence allows ordinary admission. A later eligible start after unarchive can create fresh monitoring; retained old-turn/retry/order evidence still rejects recognizable delayed events.

`GET /api/monitor/v1/sessions` keeps snapshot 1.0. Add `?snapshotVersion=1.1` to receive generation metadata; unknown or repeated version parameters reject. The envelope remains 1.0. New records get a different generation, allowing upgraded readers to forget old per-task state without observing every snapshot. Old readers retain their existing wire shape. Feed failures remain unavailable or stale, never healthy empty state.

The owner writes durable 2.0 and imports 1.0 in place with a guarded revision, preserving evidence clocks. Older owner packages cannot open 2.0; installation must back up the store and retain a compatible rollback path. Source tests use disposable stores and do not install this version. Hub #218 retains installed-client and visible-device acceptance.

See the [session retirement compatibility assessment](../../docs/session-retirement-compatibility.md) for consumer versions, durable migration, upgrade treatment and rollback limits.

## Shared display metadata

Request `/api/monitor/v1/sessions?snapshotVersion=1.2` for shared titles,
projects and label origins. Omit the parameter for the unchanged 1.0 projection;
1.1 remains available for generation-aware legacy readers. `hub_sessions` and
B.U.N.N.Y. select 1.2 and search labels, titles, projects and session IDs. Owner
labels win; the UI shows a shared title when no label exists and preserves an
untitled ID fallback. Label commands accept at most 80 Unicode scalar values.

The optional setup input `lifecycleVersion:"1.1"` produces metadata-capable
hooks for an upgraded owner. Existing receipts/configurations without it stay
1.0. Changing an installed receipt or producer file manually is not an upgrade
procedure. The source tests use synthetic settings only. For matching Desktop
sources, the owner enriches 1.1 events from its configured `codexDesktop.home`
index, allowing a Windows Codex home already mounted in WSL to supply titles.
It does not read transcript bodies or export the home path. Claude title lookup
and cwd basenames belong to the producer, as described in the
[agent-state guide](../../packages/agent-state/README.md#shared-titles-and-projects).

Hub 0.4.1 uses agent-state 3.4.0 and lifecycle 1.1.0. Durable 2.1 is not readable
by old owners. Package publication is source delivery, not installation;
real-client rename observations and physical presentation require separate
owner-authorized acceptance.

## Read-only Pixoo catalog

The Hub requests `pixoo-integration/1.1` snapshots with the explicit `apiVersion`
query and accepts legacy 1.0 responses. An explicit version refusal falls back to
an unversioned read. Commands remain `pixoo-integration/1.0`.

A caller with `read` scope and the configured controller alias can read:

- `/api/controllers/v1/:id/integration/catalog/renditions` and `catalog/playlists`,
  with `offset` and `limit` (1–100, default 25).
- `.../catalog/playlists/:playlistId` for ordered items and playback policies.
- `.../renditions/:renditionId/preview.json`, `preview.png` and `frames/:index.png`.

These are typed forwards through the controller's existing slot. They never
reserve a ticket or write the command ledger. Closed validation checks JSON,
representation hashes, PNG dimensions, strong ETags and cache headers. PNG reads
are capped at 64 KiB; manifests at 128 KiB and 1000 frames; catalog JSON at 1 MiB.
The registered controller token stays private. Authorization and upstream
membership checks precede 304 responses, including for deleted renditions.
Pixoo owns storage, imports, renditions and playback; preview support does not
qualify an animation for physical output.

## Private Wispr aggregates

The optional `wispr` block adds read-only analytics from the Windows collector's
published JSON files. The Hub never opens a Wispr or collector SQLite database.
Configure an opaque `sourceId`, absolute `aggregatePath` and `diagnosticsPath`,
with optional `freshnessMs` (default 600000), `exposeToDashboard` and
`shareTextAggregates` (both default false). The paths must name distinct regular
JSON files outside Git/cloud folders, without symlink or hard-link aliases.
Mounted Windows files retain the producer's Windows ACL qualification; Linux
files require owner-only permissions. Paths and filesystem errors never leave
the server. Changing configuration requires the normal owner-authorized restart.

Every `/api/wispr/v1/` read requires `read` scope and the configured source ID in
`devices`. Generic read permission grants no analytics access. The ID must differ
from controller aliases, playback and `hub-service`. Launcher and trusted-loopback
sessions receive it only with `exposeToDashboard: true`; configured tokens still
need their explicit grant. Responses use the existing same-origin protections
and `Cache-Control: no-store`. No analytics enter MCP or agent-session snapshots.

| GET route | Selection and result |
| --- | --- |
| `status` | Identity, reporting zone, producer times, coverage, health, presets and bounds |
| `summary` | Totals, matched duration/rate denominators, observed active days/runs and dictionary counter snapshots |
| `series` | `bucket=day\|week\|month`, default day |
| `heatmap` | Local weekday/hour cells |
| `apps` | Safe app totals and category totals |
| `language` | `period=today\|7d\|30d\|all`, default today; `corpus=raw\|cleaned\|observed`, default cleaned |
| `export` | `format=json\|csv`, default JSON; `includeText=false\|true`, default false |

Numeric routes accept inclusive `from`/`to` dates inside captured coverage and
`app`/`category` IDs from the producer's fixed mapping. Omitted dates select the
captured range. App and category combine as an intersection. Language accepts
those app/category filters and only exact precomputed presets, never custom dates
or sums of daily top-N lists. Unknown/repeated filters reject. A missing subgroup
is unavailable. Language support is `english-1` with stopword policy
`english-stop-1`; other versions remain unavailable without blocking numeric data.
`cleaned` selects the producer's `formatted` corpus; observed
edits retain unknown finality and never imply finally sent text or accuracy.
Dictionary usage is an unfiltered snapshot with an unknown counter window.

Text needs both Hub sharing and a valid producer manifest with language enabled.
Text exports also need `includeText=true`; select period/corpus instead of custom
numeric dates so numeric and text exports cover the same period. CSV is a quoted
`field,value` table including identity and coverage, with formula-like strings
neutralized. JSON is inert data served with the JSON MIME type and nosniff; a
consumer must render strings as text, never HTML, and remove its copies on logout.
Already downloaded exports cannot be recalled by later opt-out.

A single worker reads/validates files and projects responses outside the HTTP
loop. Numeric file refreshes coalesce for 30 seconds; the small manifest is read
for every request and rechecked before the worker replies. Maximum input is
16 MiB, diagnostics 4 KiB, response 1 MiB and numeric rows 10000. Oversized results
return a typed capacity error; choose a narrower range or coarser series bucket.
The HTTP worker wait is bounded to 2.5 seconds. A timed-out worker is retired
before another starts, without retrying a request automatically.
The Hub retains the accepted namespace, generation and revision across worker
replacement. A replacement starts without cached data and must pass those same
identity checks before serving files; a worker failure cannot undo an observed clear.

Missing, malformed, older or unsupported input retains last-good numeric data
with its true observation time and a failure reason. A first failure returns
unavailable. A new-generation manifest immediately retires the old dataset,
even if its replacement file is unavailable. Missing permission evidence removes
text from the cache and pending exports. Expired language presets keep their
actual as-of dates and are unavailable for the requested current period. The
first valid manifest binds a namespace for this Hub process; deliberately rebind
configuration and restart after a producer namespace replacement. File reads
observe a point in time, not changes made after the final manifest check.

Source tests and offline-package checks use synthetic data. Installation,
personal-data comparison, recurring collection and UI acceptance remain separate.
