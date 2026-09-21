# Linux hub host

This application implements the source scope of [Hub #5](https://github.com/jimmie-potts/agent-device-hub/issues/5). It targets Node 24 on Linux in WSL. Native Windows qualification is outside scope. Installation and live migration require a separate request and named owner.

The host supplies private SQLite ownership, the shared agent-state engine, authenticated loopback monitor routes, bounded controller clients and both delivered integration extensions. Supervised migration transfers state into a fenced destination, verifies routes, then opens ingestion. Installed-client qualification and full integrated performance qualification remain under #8 and #30.

## Configuration and authority

The source entry point is `node apps/hub/dist/cli.js serve /absolute/private/config.json` after `npm ci` and `npm run build`. Starting an installed service needs separate authorization. Tests use ephemeral disposable state instead.

Configuration is an owner-only regular JSON file with exactly `directory`, `ownerId`, `consumers`, `credentials`, `controllers` and `port`. The directory must already exist with mode 0700, outside a source checkout and outside `/mnt`. It belongs exclusively to this host. Normal startup refuses a persisted quiesce fence. `serve-staged` reopens it read-only for recovery; it cannot activate that old attempt. No automatic restart or fallback clears a fence.

Consumer policies use the shared core's `{id,clearOnNewTurn}` contract and must match persisted/imported state. Credentials contain a neutral `id`, SHA-256 `digest` of an independently provisioned 43-character base64url bearer token, `scopes` and registered device aliases in `devices`. Supported scopes are `read`, `ingest`, `control` and `admin`; quiesce requires control and admin. Provision producer and read-only credentials separately. Native controller tokens remain only in private server configuration. No route returns them.

Each controller has `id`, `kind` of `pixoo` or `nanoleaf`, `controllerId`, `deviceId`, numeric IPv4 loopback `endpoint` ending `/controller/v1`, and its dedicated `token`. There is at most one active HTTP request per device and no automatic retry. A capacity rejection does not reserve a controller ticket. Explicit commands retain the owning controller's request ID and revision guards. A timeout after submission is uncertain, never proof of no effects. `sent` is transport evidence only.

## HTTP boundary

All routes authenticate before replay. Host must equal the actual numeric-loopback listener, supplied Origin must match, and cross-site fetch metadata is refused. Mutations require `X-Pixoo-Request: 1`. There is no CORS grant or raw URL/protocol proxy.

| Route | Behavior |
| --- | --- |
| `GET /api/monitor/v1/sessions` | Pixoo-compatible selected-owner envelope and `matches`; optional `q` up to 120 characters and `provider` |
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
| Shared state | `@jimmie-potts/agent-state` 1.0.0; lifecycle and export 1.0; no second reducer |
| Pixoo remote source | Monitor v1 from source #31; actual facade, producer, browser actions and renderer exercised by `scripts/check-hub-pixoo.mjs` |
| Pixoo native controller | Released controller v1, #37; `pixoo-integration/1.0`, source `28f4875b7a0f0e57ca6f25d9971e125e927a5503`; strict native snapshots/commands and pinned fixtures |
| Nanoleaf native controller | Released controller v1, #28; configured Linux owner |
| Nanoleaf settings | `nanoleaf.integration/1.0`, source `f12ac6653a9f3267fa9ef62a2d6667072183d8b3`; pinned request consumer and fixtures recorded in `fixtures/nanoleaf-source.json` |

Run `npm run test:hub`, `npm run test:hub:package` and all shared checks from the worktree root. The tests use synthetic tokens, private temporary directories and fake loopback controllers. These checks do not qualify installed clients, physical results, live migration or performance budgets. A database lease prevents concurrent use of that store; it does not by itself prevent a second owner in another directory. The supervised migration path below verifies source-process release, destination and consumer readiness before resuming ingestion.

The source package command is `npm run package:hub`. It creates an archive and SHA-256 sidecar under ignored `artifacts/`. Package verification compares repeated archive bytes, installs offline into a fresh directory, checks file hashes, then runs the installed tests and import check. The dependency closure comes from the exact locally built contract/state archives, including the pinned lifecycle dependency. It does not resolve private packages from a registry.

For a separate synthetic API measurement, run `node scripts/measure-hub.mjs /absolute/new/receipt.json` after building. It starts disposable child hosts for three repetitions of 1,000 ingest/read pairs at 1, 10 and 50 session identities, retains every sample and failure, and checks peak host RSS against the owner-approved 256 MiB service RSS limit. HTTP pair timings are not the legacy full-hook boundary, so the receipt cannot qualify the full integration or replace #30 acceptance.


## Supervised state-owner migration

This is an explicitly called local API, not an HTTP administration endpoint or an installer. It supports direct Node children it starts. Independently supervised services must first be stopped through their named owner and brought under this explicit supervision; an arbitrary PID, unreachable endpoint or operator confirmation string is not release proof. The launcher uses an absolute entrypoint, arguments and an explicit environment without a shell. Do not pass device-mode configuration unless that operation is separately authorized.

1. Call `launchOwner` from `dist/migration.js` with kind `pixoo` or `hub`, the installed Node entrypoint, explicit arguments/environment and the source's private monitor credential. The launcher binds the returned URL to that child's successful startup. A failed launch terminates that exact child and verifies its exit.
2. Call `quiesceAndStop(owner, newPrivateExportPath)`. It validates the versioned export, saves and synchronizes it in a new owner-only file, requests graceful shutdown and verifies exit. It mints one process-local `ReleasedState` capability. Neither exported JSON nor a copied capability can authorize another import.
3. Call `startHub(options, {staged:true, released})` with an empty destination and matching owner ID and consumer policy. Import consumes the capability before asynchronous work. The persisted fence precedes import. Sessions remain readable; ingestion, labels and acknowledgments reject while staged.
4. Use `routeDigest` and `stageProducer` from `dist/migration-routes.js` on each explicitly named private producer file. It preserves source identity, qualification and original enablement while selecting the new endpoint/token and disabling emission. Use `stagePixooSource` on Pixoo's monitor configuration, then restart the same supervised app so its facade loads the selected remote owner. Its media directory and presentation preferences remain owned by Pixoo.
5. Call `hub.activate({producers, consumers})`. Each consumer entry has its configured `id`, staged `route`, authenticated monitor `endpoint` and that facade's private `token`. Every configured consumer must be represented. The current adapter handles Pixoo's selected-source protocol. Nanoleaf installed shared-input cutover remains #8. Activation checks the destination's ingest/control authority, actual facade owner/revision/session state and unchanged route files. It restores producer enablement while admission is still fenced, then synchronously clears the durable fence and opens admission. No new writes can enter during partial route updates.
6. Release each completed route lock with `releaseRoute`. This removes completed migration intent, never restores an old endpoint or changes producer enablement. Record any cleanup failure separately from the completed activation.

The route coordinator uses an exclusive OS-released SQLite lease in a separate migration file, private durable intent, file preimage checks, atomic replacement and directory synchronization. It does not open controller databases. A second live coordinator is refused. Initial intent is published atomically before the route changes. An interrupted attempt retains its original enablement, including when it explicitly releases its lease. After coordinator death, `recoverRoute(path, currentDigest)` accepts a dead recorded process, or an attempt this process knows failed and released its lease, with the recorded before/after file bytes. It retains original enablement and disables the producer again. `retargetRoute` can select the fresh recovery destination under the same lease. Unexpected edits or incomplete intent require inspection; the tool does not delete an unknown lock.

Any activation failure consumes that attempt's activation permission and leaves admission fenced. Some producer files may already be enabled, but their requests still reject. Restart the destination with `serve-staged`, supervise that process, quiesce/export its current state and migrate into another empty store. Recover route intent before selecting that new destination. Never clear a fence or resume the old embedded store to bypass an uncertain attempt. If a failure happens before destination import, the synchronized export and fenced source remain available for explicit owner-led recovery; no automatic fallback runs.

Rollback after accepted writes uses the same procedure with the current hub as source and a fresh host store as destination. The original Pixoo app remains a remote facade, retaining media and preferences. This tooling does not restore embedded ownership into Pixoo's occupied original monitor store. Every rollback preserves the latest labels, notices, acknowledgment, source identities and revisions. Restarted evidence remains uncertain, and presentation does not resume automatically.

The reproducible package exposes `@jimmie-potts/hub/migration` and `@jimmie-potts/hub/migration-routes` alongside its host API. The source checks exercise disposable state and real owning-service code; they do not migrate a personal installation or establish physical display accuracy.
