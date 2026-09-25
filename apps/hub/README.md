# Linux hub host

This application implements the source scope of [Hub #5](https://github.com/jimmie-potts/agent-device-hub/issues/5). It targets Node 24 on Linux in WSL. Native Windows qualification is outside scope. Installation and live migration require a separate request and named owner.

The host supplies private SQLite ownership, the shared agent-state engine, authenticated loopback monitor routes, bounded controller clients and both delivered integration extensions. Supervised migration transfers state into a fenced destination, verifies routes, then opens ingestion. The [setup runbook](SETUP.md) covers reversible producer setup and Nanoleaf cutover from #8. Installed-client and full integrated performance qualification remain separate.

## Configuration and authority

The source entry point is `node apps/hub/dist/cli.js serve /absolute/private/config.json` after `npm ci` and `npm run build`. Starting an installed service needs separate authorization. Tests use ephemeral disposable state instead.

Configuration is an owner-only regular JSON file with required `directory`, `ownerId`, `consumers`, `credentials`, `controllers` and `port`, plus optional boolean `mcp`, optional `codexDesktop` and optional [`playback`](#playback). The directory must already exist with mode 0700, outside a source checkout and outside `/mnt`. It belongs exclusively to this host. Normal startup refuses a persisted quiesce fence. `serve-staged` reopens it read-only for recovery; it cannot activate that old attempt. No automatic restart or fallback clears a fence.

Optional `codexDesktop` is `{home, hostId, sourceId}`. `home` is the absolute, normalized Codex Desktop home, such as the Windows Codex home under `/mnt/c`. `hostId` and `sourceId` match the Desktop producer's source. The host then polls Desktop's unread marker read-only every two seconds and records `read.observed` for that source's top-level sessions. The [provider qualification](../../docs/provider-qualification.md#codex-desktop-read-marker) records the marker and read rule. The host never writes Codex files and never returns the path or marker contents. An unusable marker produces no read evidence.

Consumer policies use the shared core's `{id,clearOnNewTurn}` contract and must match persisted/imported state. [Credentials](#credentials) describes the `credentials` list, how to create an entry and what each grant allows. Native controller tokens remain only in private server configuration. No route returns them.

Each controller has `id`, `kind` of `pixoo` or `nanoleaf`, `controllerId`, `deviceId`, numeric IPv4 loopback `endpoint` ending `/controller/v1`, and its dedicated `token`. There is at most one active HTTP request per device and no automatic retry. A capacity rejection does not reserve a controller ticket. Explicit commands retain the owning controller's request ID and revision guards. A timeout after submission is uncertain, never proof of no effects. `sent` is transport evidence only.

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
3. Restart the hub so it reads the new list. For an installed systemd user service, run `systemctl --user restart <unit>`. An invalid list, such as a duplicate `id` or `digest`, an uppercase or wrong-length digest, an unknown scope or too many entries, stops startup with `hub-start-failed` and takes every client offline, so keep a copy of the previous file to restore.
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
| `GET /api/controllers/v1/:id/snapshot`, `GET .../integration/snapshot`, `GET .../integration/receipt` | `read` | the controller alias `:id` |
| `POST /api/controllers/v1/:id/commands`, `POST .../integration/commands`, `POST .../integration/cancel` | `control` | the controller alias `:id` |
| `GET /api/playback/v1/snapshot` | `read` | the selected playback source ID |
| `POST /api/playback/v1/commands` | `control` | the `sourceId` named in the body |
| `POST /api/dashboard/v1/logout` | `control` | none |

`GET /api/dashboard/v1/context` lists only the controllers in the caller's `devices`. The page and its assets (`/`, `/dashboard.js`, `/dashboard.css`) need no token, and `POST /api/dashboard/v1/launch` takes a one-time launcher code instead.

When `mcp` is enabled, `/mcp` accepts configured tokens only. It uses the `read` and `control` scopes, ignores `ingest` and `admin`, and needs no `X-Pixoo-Request` header. A missing or unknown token gets HTTP 401. A tool the token's scopes or `devices` do not cover is left out of the tool list, and calling it anyway returns a tool error with code `forbidden` rather than HTTP 403. `<prefix>` is the per-device value that `hub_devices` returns.

| MCP tools | Scope | `devices` entry |
| --- | --- | --- |
| `hub_sessions`, `hub_devices` | `read` | none; `hub_devices` lists only the caller's controllers |
| `hub_label`, `hub_acknowledge`, `hub_recover_approval` | `control` | none |
| `<prefix>_status`, `<prefix>_integration_status`, and `<prefix>_integration_receipt` for Nanoleaf only | `read` | that controller's alias |
| `<prefix>_power_set`, `_brightness_set`, `_mode_set`, `_media_start`, `_media_control`, `_integration_set`, and `_integration_cancel` for Nanoleaf only | `control` | that controller's alias |

There are no playback MCP tools yet; [#37](https://github.com/jimmie-potts/agent-device-hub/issues/37) owns them.

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

The B.U.N.N.Y. launcher (see [Browser frontend](#browser-frontend)) does not use a credential from the file. It creates a temporary one with `read` and `control` on every configured controller alias for up to eight hours. That session has no `ingest`, `admin` or playback grant, and it cannot authenticate MCP. The token form at `/` instead accepts a configured token, and the page then has exactly that credential's grants.

Each browser session owns its command tickets, its change streams and its retained replay results. Logout, the eight-hour expiry, eviction at the 16-session limit, credential replacement and shutdown all retire a session the same way. Its token and cached requests are refused, its streams close, and its ticket ledger and settled replay results are released. A command the session already submitted keeps running. It is not cancelled or sent again, and its replay entry stays charged until the command settles, then is released once. A retired session's late write, whose body arrives after retirement, is refused before it reaches the owner or a controller. After every browser session retires and its submitted commands settle, the host holds no browser ledger, stream or replay entry. Tickets for configured credentials are unaffected. Disconnecting a dashboard that was opened with a configured token ends no session: that credential keeps its streams, its ticket sequence and its retained results.

## HTTP boundary

All routes authenticate before replay. Host must equal the actual numeric-loopback listener, supplied Origin must match, and cross-site fetch metadata is refused. Mutations require `X-Pixoo-Request: 1`. There is no CORS grant or raw URL/protocol proxy.

| Route | Behavior |
| --- | --- |
| `GET /api/monitor/v1/sessions` | Selected-owner envelope; `matches` only with a search filter; optional `q` up to 120 characters and `provider` |
| `POST /api/monitor/v1/events` | Shared lifecycle event, maximum 2048 bytes, ingest scope |
| `POST /api/monitor/v1/commands` | Label, exact notice acknowledgment, explicit approval recovery or quiesce, using the latest server-issued request ID |
| `GET /api/monitor/v1/changes` | Bounded SSE notifications pushed as each revision commits, plus a 1-second heartbeat and resync; fetch a current sessions snapshot rather than replaying effects |
| `GET /api/hub/v1/health` | Shared collector health and separate controller status, without refreshing device observations |
| `GET /api/controllers/v1/:id/snapshot` | Validated owner snapshot for an authorized registered alias |
| `POST /api/controllers/v1/:id/commands` | Validated controller v1 command and its original receipt/status |
| `GET /api/controllers/v1/:id/integration/snapshot` | Validated Nanoleaf or Pixoo settings snapshot |
| `POST /api/controllers/v1/:id/integration/commands` | Owning versioned settings request |
| `GET /api/controllers/v1/:id/integration/receipt?epoch=...&sequence=...` | Nanoleaf extension receipt, without issuing another command |
| `POST /api/controllers/v1/:id/integration/cancel` | Nanoleaf extension cancellation request; cannot undo an applied edit |
| `GET /api/playback/v1/snapshot` | Selected playback source's snapshot; see [Playback](#playback) |
| `POST /api/playback/v1/commands` | One source-bound playback command and its receipt |

Global HTTP admission is 32, streams 16, connections 64, headers 8192 bytes, command bodies 65536 bytes and requests three seconds. Replay retains at most 256 entries and 262144 fingerprint bytes across principals; pending entries cannot be evicted. Repeated quiesce tickets share one immutable export. Native controller calls have a two-second deadline and one MiB response limit. Slow streams disconnect after five seconds of backpressure. Credential replacement closes streams, retires every browser session and removed credential's tickets, and reauthorizes future requests before replay. Restart changes the command epoch.

## Playback

[Hub #175](https://github.com/jimmie-potts/agent-device-hub/issues/175) adds shared playback with the Sony HT-A9 as its first source. The owner's iPhone keeps playing Apple Music to the soundbar over AirPlay; the hub reads what is playing and can send pause, next and previous. No audio passes through the hub. The [HT-A9 qualification](../../docs/iphone-apple-music-qualification.md) records the receiver behavior this relies on.

### Configuration

```json
"playback": {
  "selected": "living-room",
  "sources": [{"id": "living-room", "kind": "sony", "endpoint": "http://192.168.1.20:10000/sony"}]
}
```

`sources` currently holds exactly one source, and `selected` must name it. `id` is a neutral label you choose. It becomes the `sourceId` in every snapshot and command, so never use a track name. An ID that looks like an IPv4 address or contains the endpoint address is rejected. It must differ from every controller alias and from `hub-service`. `endpoint` must be exactly `http://<IPv4>:<port>/sony` with a numeric private (10/8, 172.16/12, 192.168/16) or loopback address and no credentials, query or fragment. The Sony Audio Control API listens on port 10000. Any other shape stops the hub with `invalid-playback`. Keep the address in the private configuration file only.

Credentials need the source ID in `devices`: `read` scope for snapshots and `control` scope for commands. See [Credentials](#credentials) to create one. Browser launch sessions do not receive a playback grant; UI and MCP tools belong to [#37](https://github.com/jimmie-potts/agent-device-hub/issues/37). The Tidbyt runner's optional now-playing tile ([#38](https://github.com/jimmie-potts/agent-device-hub/issues/38)) is a read-only consumer of the snapshot; see the [Tidbyt guide](../../controllers/tidbyt/README.md#now-playing-decisions).

### Snapshot

`GET /api/playback/v1/snapshot` returns:

```json
{"apiVersion": "1.0", "sourceId": "living-room", "availability": "available", "observedAtMs": 1790000000000, "ageMs": 850,
 "playback": {"status": "playing", "title": "...", "artist": "...", "album": "...", "controls": ["pause", "next", "previous"]}}
```

`observedAtMs` is the hub's wall-clock time of the last successful read. `ageMs` is the larger of the monotonic and wall-clock ages, so neither a system clock change nor a suspend can make an old read look fresh. A successful read refreshes both even when nothing changed; a failed read does not.

| `availability` | Age of the last successful read | `playback` |
| --- | --- | --- |
| `available` | under 5 seconds | last observation |
| `stale` | 5 to under 30 seconds | last observation, kept for context |
| `unavailable` | 30 seconds or more, or no read yet | `null` |

The hub starts `unavailable`. A receiver that stops answering never turns into `paused`. `status` is `playing`, `paused`, `stopped`, `inactive` or `unknown`. `inactive` means the receiver answered but AirPlay is not its current input. `title`, `artist` and `album` are omitted when the receiver does not supply them. Artwork, position, duration and song-change events are not part of this version; see [#229](https://github.com/jimmie-potts/agent-device-hub/issues/229) and [#39](https://github.com/jimmie-potts/agent-device-hub/issues/39).

### Commands

`POST /api/playback/v1/commands` takes exactly `{"requestId": "...", "sourceId": "living-room", "action": "pause"}` with `X-Pixoo-Request: 1` and a body of at most 1024 bytes. `requestId` is a client-chosen neutral ID. `action` is `play`, `pause`, `next` or `previous`, but only actions listed in the current `controls` are accepted, and only while `availability` is `available`. A stale snapshot still shows its last controls for context. The Sony source lists pause, next and previous only while AirPlay is playing and never lists play, because play/resume was not qualified. On this receiver, previous restarts the current song.

| Result | Meaning |
| --- | --- |
| 200 `sent` | The receiver accepted the call. This is transport evidence, not proof the phone reacted. |
| 502 `failed` | The receiver refused the call. |
| 503 `uncertain` | No JSON-RPC result or error: a timeout after 1.5 seconds, a network error, or a non-200, malformed or mismatched reply. The command may have taken effect. |
| 400 `invalid-input`, 403 `forbidden` | Bad body, missing scope, header or source grant |
| 404 `unknown-source` | The body names a source other than the selected one |
| 409 `request-conflict` | The request ID was already used with a different body |
| 413 `capacity` | The body is larger than 1024 bytes |
| 422 `unsupported-control` | The action is not in the current controls |
| 429 `capacity` | Another playback command is still running |
| 503 `source-unavailable`, `owner-quiesced` | The source is not `available`, or the host is staged |

Admitted results carry `{requestId, sourceId, action, outcome}`. Repeating a request ID with the same body returns the original receipt without contacting the receiver, so a client retry after a lost response is safe. The hub keeps the latest 64 receipts; a restart clears them. Only one command runs at a time, nothing is retried automatically and no command is redirected to another source or address.

### Sony source behavior

The Sony module calls `avContent.getPlayingContentInfo` version 1.2 at startup and then every two seconds. Each call has a 1.5-second timeout and a 64 KiB reply limit, and a read already in progress is reused instead of starting another. It uses the entry whose `source` is `extInput:airPlay`, maps `PLAYING`, `PAUSED` and `STOPPED` to the shared statuses and any other state to `unknown`. It trims `title`, `artist` and `albumName` and limits each to 256 characters. Other receiver fields, including the thumbnail URL that embeds the receiver address, are dropped. JSON-RPC errors, non-200 replies, malformed bodies, timeouts and network errors are failed reads. Commands call `pausePlayingContent` 1.1, `setPlayNextContent` 1.0 or `setPlayPreviousContent` 1.0; a JSON-RPC result is `sent` and a JSON-RPC error is `failed`.

### Adding a source

`src/playback.ts` is the shared module and imports no source code. A source implements `PlaybackSource`:

- `id`: the configured neutral source ID.
- `start(report)`: begin observing and call `report` with a normalized observation after every successful read, including unchanged ones. Never report a failed read.
- `command(action)`: resolve `sent` when the source accepted the call or `failed` when it refused before any effect. Reject for any uncertain result, and apply your own timeout under the host's three-second request limit.
- `close()`: stop observing and abort in-flight work. If it fails, the host still finishes shutting down and then reports the error.

`src/sony.ts` is the reference adapter. `server.ts` validates the `playback` envelope, builds the source for its `kind` and closes it with the host. A second source currently needs a new `kind` branch there. Multi-source runtime and selection are deferred. The [OpenSpec design](../../openspec/changes/archive/2026-09-24-gh-175-shared-playback/design.md#future-two-source-flow) describes how two sources keep independent freshness, commands stay bound to the selected source and an unavailable selection never falls back silently.

## Compatibility and evidence

| Boundary | Contract and evidence |
| --- | --- |
| Shared state | `@jimmie-potts/agent-state` 3.1.0; lifecycle 1.0, durable export 2.0 (1.0 import), snapshots 1.0/1.1; no second reducer |
| Pixoo remote source | Monitor v1 from source #31; actual facade, producer, browser actions and renderer exercised by `scripts/check-hub-pixoo.mjs` |
| Pixoo native controller | Released controller v1, #37; `pixoo-integration/1.0`, source `28f4875b7a0f0e57ca6f25d9971e125e927a5503`; strict native snapshots/commands and pinned fixtures |
| Nanoleaf native controller | Released controller v1, #28; configured Linux owner |
| Nanoleaf settings | `nanoleaf.integration/1.0`, source `80628498136203a8f5fcb06ab5fa306e961e2def`; pinned request consumer and fixtures recorded in `fixtures/nanoleaf-source.json` |

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

## Browser frontend

The packaged hub serves B.U.N.N.Y. at `/`, with fixed `/dashboard.js` and
`/dashboard.css` assets and a restrictive same-origin content security policy.
`GET /api/dashboard/v1/context` authenticates with read scope and exposes only
that principal's registered component aliases, control permission and configured
monitor consumers. Native controller credentials and endpoint URLs are excluded.

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
`control` on the host's configured aliases and no `ingest` or `admin`. The
browser bearer cannot authenticate MCP. Disconnect revokes it; reload discards
it, so use the launcher again. At the 16-session limit, a new launch revokes
the oldest browser session. Existing machine and manual browser credentials
remain configured separately. The private socket is removed on orderly
shutdown. On restart, the host removes an unresponsive socket only when it is
still the same owner-owned socket; a live socket blocks startup. Do not clear
the state-owner database or start a second owner.

This source command does not update the running installation. A named owner
must install a reviewed Hub package and wire the shortcut to its actual private
configuration. Browser handoff tests use disposable stores and fake controllers;
they do not qualify a personal service or device result.

Optional `editorLinks` maps registered aliases to credential-free numeric-loopback
HTTP editor links without query/fragment. Existing API-only configurations remain
valid. See [the dashboard guide](../dashboard/README.md) for provisioning,
capability-based views and synthetic verification.

## Optional local MCP

Set the optional private configuration field `mcp` to `true` to mount `/mcp` on the same loopback listener. Omitted or false leaves it disabled. This is source configuration support; enabling an installed service still needs separate authorization. The handler reuses `@jimmie-potts/device-mcp` 1.0.0, its pinned SDK and supported protocols, and the host's current machine-credential verifier. MCP does not require the browser mutation header; existing REST protections are unchanged.

`hub_sessions` returns the same qualified snapshot, provider/query matches and next state request ID as the HTTP session route. `hub_label` and `hub_acknowledge` use `request_id` for that exact string ticket and share the HTTP command ledger. No ingest, quiesce, migration or administrative tool is exposed. Read/control scopes apply as on the owning routes; read permission does not grant control. Discovery and reads never acknowledge notices or infer task success.

`hub_devices` lists authorized configured aliases and stable `toolPrefix` values without querying controllers. Each prefix binds status, power, brightness, mode, media and integration tools to one configured owner. Prefixes include a bounded alias segment and SHA-256 suffix so dotted aliases and long IDs remain valid and distinct. The reserved `hub-service` alias represents only global application tools and cannot name a configured controller when MCP is enabled. It is excluded from device discovery. Native controller/device IDs inside results remain unchanged, including when multiple controllers use the same native device ID.

| Suffix | Behavior |
| --- | --- |
| `_status` | Validated native controller v1 snapshot |
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

For Pixoo, first read `_integration_status` and explicitly select Media through
`_integration_set` if necessary; wait for the observed Media mode, then obtain
fresh controller guards. Each media call forwards one command. It does not switch
modes, restore Monitor or start a retry. Pixoo retains its playback and mode
policy. Its catalog and rendition handlers remain in the Pixoo application and
its optional local MCP endpoint remains available independently. These hub tools
only forward the two controller v1 media commands.

`npm run test:hub:mcp` exercises synthetic Codex/Claude protocol profiles for MCP 2025-11-25 and 2025-06-18, scoped discovery, Host/Origin checks, credential replacement, HTTP/MCP replay, native settings, independent controller failure, bounded concurrency, disconnect and stale evidence. The reproducible hub archive bundles MCP and its dependency closure; `npm run test:hub:package` repeats these tests after offline installation. These are source and loopback checks, not installed Codex/Claude, Windows/WSL client routing or physical acceptance. Feed this coverage into Hub #9; installed qualification remains #8 and device-owned acceptance.

## Desktop retirement and archive admission

Codex Desktop `runtime.ended` retires the known session tree through the shared owner without Codex-home access. The existing `codexDesktop` configuration additionally supplies read-only archive admission evidence for its exact host/source namespace. The host inspects at most 10,000 entries under `archived_sessions` within the owner's 200 ms bound, matching regular `rollout-YYYY-MM-DDTHH-MM-SS-<sessionId>.jsonl` filenames. It does not open transcripts, poll archives, follow an archive-directory symlink, or change Codex files. Missing/unreadable evidence allows ordinary admission. A later eligible start after unarchive can create fresh monitoring; retained old-turn/retry/order evidence still rejects recognizable delayed events.

`GET /api/monitor/v1/sessions` keeps snapshot 1.0. Add `?snapshotVersion=1.1` to receive generation metadata; unknown or repeated version parameters reject. The envelope remains 1.0. New records get a different generation, allowing upgraded readers to forget old per-task state without observing every snapshot. Old readers retain their existing wire shape. Feed failures remain unavailable or stale, never healthy empty state.

The owner writes durable 2.0 and imports 1.0 in place with a guarded revision, preserving evidence clocks. Older owner packages cannot open 2.0; installation must back up the store and retain a compatible rollback path. Source tests use disposable stores and do not install this version. Hub #218 retains installed-client and visible-device acceptance.

See the [Desktop retirement compatibility assessment](../../docs/session-retirement-compatibility.md) for consumer versions, durable migration and rollback limits.
