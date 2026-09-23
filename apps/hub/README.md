# Linux hub host

This application implements the source scope of [Hub #5](https://github.com/jimmie-potts/agent-device-hub/issues/5). It targets Node 24 on Linux in WSL. Native Windows qualification is outside scope. Installation and live migration require a separate request and named owner.

The host supplies private SQLite ownership, the shared agent-state engine, authenticated loopback monitor routes, bounded controller clients and both delivered integration extensions. Supervised migration transfers state into a fenced destination, verifies routes, then opens ingestion. The [setup runbook](SETUP.md) covers reversible producer setup and Nanoleaf cutover from #8. Installed-client and full integrated performance qualification remain separate.

## Configuration and authority

The source entry point is `node apps/hub/dist/cli.js serve /absolute/private/config.json` after `npm ci` and `npm run build`. Starting an installed service needs separate authorization. Tests use ephemeral disposable state instead.

Configuration is an owner-only regular JSON file with required `directory`, `ownerId`, `consumers`, `credentials`, `controllers` and `port`, plus optional boolean `mcp`. The directory must already exist with mode 0700, outside a source checkout and outside `/mnt`. It belongs exclusively to this host. Normal startup refuses a persisted quiesce fence. `serve-staged` reopens it read-only for recovery; it cannot activate that old attempt. No automatic restart or fallback clears a fence.

Consumer policies use the shared core's `{id,clearOnNewTurn}` contract and must match persisted/imported state. Credentials contain a neutral `id`, SHA-256 `digest` of an independently provisioned 43-character base64url bearer token, `scopes` and registered device aliases in `devices`. Supported scopes are `read`, `ingest`, `control` and `admin`; quiesce requires control and admin. Provision producer and read-only credentials separately. Native controller tokens remain only in private server configuration. No route returns them.

Each controller has `id`, `kind` of `pixoo` or `nanoleaf`, `controllerId`, `deviceId`, numeric IPv4 loopback `endpoint` ending `/controller/v1`, and its dedicated `token`. There is at most one active HTTP request per device and no automatic retry. A capacity rejection does not reserve a controller ticket. Explicit commands retain the owning controller's request ID and revision guards. A timeout after submission is uncertain, never proof of no effects. `sent` is transport evidence only.

## HTTP boundary

All routes authenticate before replay. Host must equal the actual numeric-loopback listener, supplied Origin must match, and cross-site fetch metadata is refused. Mutations require `X-Pixoo-Request: 1`. There is no CORS grant or raw URL/protocol proxy.

| Route | Behavior |
| --- | --- |
| `GET /api/monitor/v1/sessions` | Selected-owner envelope; `matches` only with a search filter; optional `q` up to 120 characters and `provider` |
| `POST /api/monitor/v1/events` | Shared lifecycle event, maximum 2048 bytes, ingest scope |
| `POST /api/monitor/v1/commands` | Label, exact notice acknowledgment or quiesce, using the latest server-issued request ID |
| `GET /api/monitor/v1/changes` | Bounded SSE notifications and resync; fetch a current sessions snapshot rather than replaying effects |
| `GET /api/hub/v1/health` | Shared collector health and separate controller status, without refreshing device observations |
| `GET /api/controllers/v1/:id/snapshot` | Validated owner snapshot for an authorized registered alias |
| `POST /api/controllers/v1/:id/commands` | Validated controller v1 command and its original receipt/status |
| `GET /api/controllers/v1/:id/integration/snapshot` | Validated Nanoleaf or Pixoo settings snapshot |
| `POST /api/controllers/v1/:id/integration/commands` | Owning versioned settings request |
| `GET /api/controllers/v1/:id/integration/receipt?epoch=...&sequence=...` | Nanoleaf extension receipt, without issuing another command |
| `POST /api/controllers/v1/:id/integration/cancel` | Nanoleaf extension cancellation request; cannot undo an applied edit |

Global HTTP admission is 32, streams 16, connections 64, headers 8192 bytes, command bodies 65536 bytes and requests three seconds. Replay retains at most 256 entries and 262144 fingerprint bytes across principals; pending entries cannot be evicted. Repeated quiesce tickets share one immutable export. Native controller calls have a two-second deadline and one MiB response limit. Slow streams disconnect after five seconds of backpressure. Credential replacement closes streams and reauthorizes future requests before replay. Restart changes the command epoch.

## Compatibility and evidence

| Boundary | Contract and evidence |
| --- | --- |
| Shared state | `@jimmie-potts/agent-state` 2.0.0; lifecycle and export 1.0; no second reducer |
| Pixoo remote source | Monitor v1 from source #31; actual facade, producer, browser actions and renderer exercised by `scripts/check-hub-pixoo.mjs` |
| Pixoo native controller | Released controller v1, #37; `pixoo-integration/1.0`, source `28f4875b7a0f0e57ca6f25d9971e125e927a5503`; strict native snapshots/commands and pinned fixtures |
| Nanoleaf native controller | Released controller v1, #28; configured Linux owner |
| Nanoleaf settings | `nanoleaf.integration/1.0`, source `80628498136203a8f5fcb06ab5fa306e961e2def`; pinned request consumer and fixtures recorded in `fixtures/nanoleaf-source.json` |

Run `npm run test:hub`, `npm run test:hub:package` and all shared checks from the worktree root. The tests use synthetic tokens, private temporary directories and fake loopback controllers. These checks do not qualify installed clients, physical results, live migration or performance budgets. A database lease prevents concurrent use of that store; it does not by itself prevent a second owner in another directory. The supervised migration path below verifies source-process release, destination and consumer readiness before resuming ingestion.

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

Rollback after accepted writes uses the same procedure with the current hub as source and a fresh host store as destination. The original Pixoo app remains a remote facade, retaining media and preferences. This tooling does not restore embedded ownership into Pixoo's occupied original monitor store. Every rollback preserves the latest labels, notices, acknowledgment, source identities and revisions. Restarted evidence remains uncertain, and presentation does not resume automatically.

The reproducible package exposes `@jimmie-potts/hub/migration` and `@jimmie-potts/hub/migration-routes` alongside its host API. The source checks exercise disposable state and real owning-service code; they do not migrate a personal installation or establish physical display accuracy.

## Browser frontend

The packaged hub serves BUNNY at `/`, with fixed `/dashboard.js` and
`/dashboard.css` assets and a restrictive same-origin content security policy.
`GET /api/dashboard/v1/context` authenticates with read scope and exposes only
that principal's registered component aliases, control permission and configured
monitor consumers. Native controller credentials and endpoint URLs are excluded.

### Open BUNNY without typing a token

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
it, so use the launcher again. Existing machine and manual browser credentials
remain configured separately. The private socket is removed on orderly
shutdown. If startup reports an occupied socket after a crash, establish that
the old host is gone and inspect the private path before removing only that
stale socket. Do not clear the state-owner database or start a second owner.

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

`hub_devices` lists authorized configured aliases and stable `toolPrefix` values without querying controllers. Each prefix binds status, power, brightness, mode and integration tools to one configured owner. Prefixes include a bounded alias segment and SHA-256 suffix so dotted aliases and long IDs remain valid and distinct. The reserved `hub-service` alias represents only global application tools and cannot name a configured controller when MCP is enabled. It is excluded from device discovery. Native controller/device IDs inside results remain unchanged, including when multiple controllers use the same native device ID.

| Suffix | Behavior |
| --- | --- |
| `_status` | Validated native controller v1 snapshot |
| `_power_set`, `_brightness_set`, `_mode_set` | Native request ticket, configuration revision and generation guards; unsupported capabilities return the owner's rejection |
| `_integration_status` | Validated Pixoo or Nanoleaf integration snapshot |
| `_integration_set` | Pixoo `request_id`, revision/generation and mode/view action, or Nanoleaf `requestId`, expected revision and declared settings command |
| `_integration_receipt`, `_integration_cancel` | Nanoleaf receipt lookup and explicit cancellation using the original ticket |

All tool results use the reusable module's extension envelope. `data.result` contains the owning snapshot, outcome or receipt. Safe pre-admission errors use `data.code`; ambiguous writes retain `priorEffects: possible`, the original request ID and `retry: never-automatically`. An accepted or applied configuration is not proof of a physical effect. Disconnect and MCP session removal stop response delivery, not admitted owner work.

Pixoo catalog/player handlers remain in the Pixoo application. This host has no registered machine adapter for them and does not recreate them or borrow browser tokens. Its optional local Pixoo MCP endpoint remains available independently. Unsupported device operations stay unsupported.

`npm run test:hub:mcp` exercises synthetic Codex/Claude protocol profiles for MCP 2025-11-25 and 2025-06-18, scoped discovery, Host/Origin checks, credential replacement, HTTP/MCP replay, native settings, independent controller failure, bounded concurrency, disconnect and stale evidence. The reproducible hub archive bundles MCP and its dependency closure; `npm run test:hub:package` repeats these tests after offline installation. These are source and loopback checks, not installed Codex/Claude, Windows/WSL client routing or physical acceptance. Feed this coverage into Hub #9; installed qualification remains #8 and device-owned acceptance.
