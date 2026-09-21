# Linux hub host candidate

This application is an in-progress implementation of [Hub #5](https://github.com/jimmie-potts/agent-device-hub/issues/5). It targets Node 24 on Linux in WSL. Native Windows qualification is outside scope. Do not install this candidate as a replacement for an existing owner.

The current foundation supplies private SQLite ownership, the shared agent-state engine, authenticated loopback monitor routes and bounded clients for controller v1 and the Nanoleaf integration extension. Migration activation, complete owning-service acceptance, Pixoo #33 settings and integrated performance qualification remain tracked in the active OpenSpec tasks. This is not completed standalone-host delivery.

## Configuration and authority

The source entry point is `node apps/hub/dist/cli.js serve /absolute/private/config.json` after `npm ci` and `npm run build`. Starting an installed service needs separate authorization. Tests use ephemeral disposable state instead.

Configuration is an owner-only regular JSON file with exactly `directory`, `ownerId`, `consumers`, `credentials`, `controllers` and `port`. The directory must already exist with mode 0700, outside a source checkout and outside `/mnt`. It belongs exclusively to this host. The application refuses a store with a persisted quiesce fence; no automatic restart or fallback clears it.

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
| `GET /api/controllers/v1/:id/integration/snapshot` | Nanoleaf-owned settings projection |
| `POST /api/controllers/v1/:id/integration/commands` | Nanoleaf versioned settings request |
| `GET /api/controllers/v1/:id/integration/receipt?epoch=...&sequence=...` | Original extension receipt, without issuing another command |
| `POST /api/controllers/v1/:id/integration/cancel` | Original extension cancellation request; cannot undo an applied edit |

Global HTTP admission is 32, streams 16, connections 64, headers 8192 bytes, command bodies 65536 bytes and requests three seconds. Replay retains at most 256 entries and 262144 fingerprint bytes across principals; pending entries cannot be evicted. Repeated quiesce tickets share one immutable export. Native controller calls have a two-second deadline and one MiB response limit. Slow streams disconnect after five seconds of backpressure. Credential replacement closes streams and reauthorizes future requests before replay. Restart changes the command epoch.

## Compatibility and evidence

| Boundary | Contract and evidence |
| --- | --- |
| Shared state | `@jimmie-potts/agent-state` 1.0.0; lifecycle and export 1.0; no second reducer |
| Pixoo remote source | Monitor v1 from source #31; full facade/cutover acceptance pending |
| Pixoo native controller | Released controller v1, #37; Monitor/Media and filter API delivered by #33; hub integration pending |
| Nanoleaf native controller | Released controller v1, #28; configured Linux owner |
| Nanoleaf settings | `nanoleaf.integration/1.0`, source `f12ac6653a9f3267fa9ef62a2d6667072183d8b3`; pinned request consumer and fixtures recorded in `fixtures/nanoleaf-source.json` |

Run `npm run test:hub`, `npm run test:hub:package` and all shared checks from the worktree root. The tests use synthetic tokens, private temporary directories and fake loopback controllers. These checks do not qualify installed clients, physical results, live migration or performance budgets. A database lease prevents concurrent use of that store; it does not by itself prevent a second owner in another directory. Full migration must verify old-owner release, destination and consumer readiness before resuming ingestion.

The source package command is `npm run package:hub`. It creates an archive and SHA-256 sidecar under ignored `artifacts/`. Package verification compares repeated archive bytes, installs offline into a fresh directory, checks file hashes, then runs the installed tests and import check. The dependency closure comes from the exact locally built contract/state archives, including the pinned lifecycle dependency. It does not resolve private packages from a registry.

For a separate synthetic API measurement, run `node scripts/measure-hub.mjs /absolute/new/receipt.json` after building. It starts disposable child hosts for three repetitions of 1,000 ingest/read pairs at 1, 10 and 50 session identities, retains every sample and failure, and checks peak host RSS against the owner-approved 256 MiB service RSS limit. HTTP pair timings are not the legacy full-hook boundary, so the receipt cannot qualify the full integration or replace #30 acceptance.
