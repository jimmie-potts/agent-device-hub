# Local controller API

The optional controller API exposes the bridge's existing Work, Quiet and Free modes, plus power, brightness and saved-scene activation, to local native clients for each configured device. Each device's single worker owns that device's light updates on Linux. Media, zones and preview are explicitly unsupported in v1; requested Free-mode animations use the [integration extension](integration-api.md#requested-animations). Work/Quiet brightness and scene restoration retain their existing policies; [general controls](#general-controls) describe how a native override interacts with them.

The [protected controller specification](../openspec/specs/protected-controller-api/spec.md) owns the machine behavior. [Issue #28](https://github.com/jimmie-potts/codex-nanoleaf/issues/28) owns the original delivery scope, [issue #64](https://github.com/jimmie-potts/codex-nanoleaf/issues/64) the general controls and [issue #113](https://github.com/jimmie-potts/codex-nanoleaf/issues/113) the second device. Shared monitoring, installation/real-client acceptance and physical previews have separate issues.

## Linux installation

[Fresh Linux setup](linux-install.md) provisions the controller dependencies and credentials. Run the generated controller user service, or `~/.local/share/codex-nanoleaf/nanoleaf controller-serve --port 41231` in the foreground. Use the selected custom port when setup overrides the default. Its state and worker stay in Linux. MCP calls this listener directly; no Windows helper is involved. Enrolling [NL22 Light Panels](linux-install.md#add-nl22-light-panels) neither issues nor changes machine credentials. The controller reaches the Panels only after you [add them](#add-the-nl22-light-panels). [ADR 0007](decisions/0007-linux-runtime-ownership.md) records the Linux ownership, and [ADR 0015](decisions/0015-per-device-controller-ledgers.md) records the per-device ledgers. Linux installed acceptance belongs to [#55](https://github.com/jimmie-potts/codex-nanoleaf/issues/55).

## Dependency and activation

Hooks, map and worker startup use the standard library. The listener lazily imports the unchanged shared Python consumer and needs the pinned packages in `requirements-controller.txt`, which the Linux installer provisions in the installation's virtual environment. A disabled machine API does not require those packages.

These are operator commands for the separately authorized Linux installation. Source checkout tests do not run them against personal state. Use the installed launcher:

```bash
nanoleaf controller-configure --controller-id local-controller --device-id wall --source-id local-source
nanoleaf controller-token --principal local-hub
nanoleaf controller-serve --port 41231
```

The token command prints a new opaque credential once. Keep it in the native client's private configuration, separate from its endpoint and target ID. Add `--read-only` when issuing a read credential. Reissuing a principal replaces its previous credential and cancels its unsent work. Up to 32 principals are retained. IDs use 1 through 128 ASCII letters, digits, dots, underscores or hyphens. Existing IDs cannot be redirected through these commands.

`controller-server.json` records the loopback port while the listener runs. `controller-serve --port <port>` selects a fixed loopback port; the default selects an available port. The generated user service runs it with the installation's fixed port. Its lifetime is separate from the wall map.

```bash
nanoleaf controller-status
nanoleaf controller-revoke --principal local-hub
nanoleaf controller-disable
```

Revocation blocks old credentials before replay lookup and cancels unsent work. Disable stops the listener and cancels pending machine work without deleting tasks or preferences. To restart a disabled listener, explicitly run `controller-serve` or restart the user service. Installed commands open only the installation's own Linux state.

## Add the NL22 Light Panels

After [enrolling the Panels](linux-install.md#add-nl22-light-panels) as `panels`, add them to the controller with the same controller and source IDs:

```bash
nanoleaf controller-configure --controller-id local-controller --device-id panels --source-id local-source
nanoleaf controller-status --device-id panels
```

The Panels get their own ledger: identity and epoch, configuration revision, generation, request journal, feed, saved scenes, overrides and hold. The Panels' worker is the only process that executes that ledger's requests, so each device keeps one writer. A hold after a failed or uncertain Panels write stops only the Panels' automatic retries. A mode command for one device cancels only that device's queued controls. Existing credentials cover both devices, so no new token is needed. Running the command again changes nothing. Removing the Panels with `device-remove` deletes their ledger too. The command refuses an unregistered device, different controller or source IDs, and a first configuration that names the Panels instead of the Lines. The running listener serves the new device on its next request; no restart is needed.

For the hub, add a second controller entry with the same endpoint and credential and `deviceId` `panels`. The hub's dashboard shows no controls for the Panels until [agent-device-hub#323](https://github.com/jimmie-potts/agent-device-hub/issues/323) lands. The hub rejects the Panels' read-only extension snapshot, whose configuration operations are unsupported, and the dashboard loads that snapshot together with the v1 snapshot. The hub's v1 API routes and the MCP tools still control the Panels, and #113's live check uses Codex. The owner accepted this deferral on 2026-09-25. The feed poller, the integration settings queue and requested animations remain Lines-only. The [local MCP host](local-mcp.md#control-the-panels) binds the Panels through `panelsDeviceId`.

## Routes and authentication

Every request requires `Authorization: Bearer <machine credential>` and the exact `Host: 127.0.0.1:<port>`. Browser edit tokens do not qualify. A supplied Origin must match `http://127.0.0.1:<port>`; cross-site Fetch-Metadata is rejected. There is no CORS permission or LAN listener. The owning worker can still reach its privately configured LAN device.

| Request | Response |
| --- | --- |
| `GET /controller/v1/devices` | `{apiVersion:"1.0",devices:[snapshot, ...]}` for every configured device, the Lines first |
| `GET /controller/v1/snapshot?deviceId=<id>` | Shared snapshot |
| `POST /controller/v1/commands` | Shared receipt, or bounded `{failure:{code}}` before admission |
| `GET /controller/v1/feed?deviceId=<id>&epoch=<id>&sequence=<integer>` | Bounded array of shared feed events |

Each route addresses the ledger its `deviceId` names; one credential authorizes every configured device, and an unconfigured device is forbidden. Commands use JSON and the exact shared `Request` schema. Obtain `nextRequestId`, `configurationRevision` and `generation` from a current snapshot. Supply those values as `requestId`, `expectedConfigurationRevision` and `expectedGeneration`, alongside explicit `controllerId`, `deviceId` and one command: `{kind:"mode.set",mode:"Work"|"Quiet"|"Free"}`, `{kind:"power.set",on:boolean}`, `{kind:"brightness.set",percent:0..100}` or `{kind:"scene.activate",sceneId:<advertised id>}`. Unknown fields, raw destinations, fractional/unsafe counters, duplicate JSON keys and non-finite numbers fail validation. Authentication and target scope checks happen before replay.

Admission returns HTTP 202 for queued work. An identical pending request joins its original work; a completed identical request returns its retained receipt with HTTP 200. Different bodies under one ID conflict. Old uncached/foreign IDs expire; future IDs fail ordering. Semantic failures after reservation retain their receipt. Pre-admission capacity rejection consumes no identity. Use the shared error mapping: 400 invalid, 401 unauthenticated, 403 forbidden, 404 unknown target, 409 conflict/order/stale, 410 expired, 422 unsupported, 429 capacity and 503 temporary service/launch failure.

A fulfilled mode that needs no physical work ends as `cancelled`, without failure, with `priorEffects:none` and empty operation arrays. Shared v1 has no separate no-op completion outcome. This result does not claim a transport send.

## General controls

The capability declaration marks `power` supported, `brightness` supported from 0 to 100 and `scenes` supported with the discovered saved-scene IDs, bounded to 256; `media`, `zones` and `preview` stay unsupported. The three commands travel through the same request identity, revision, generation, replay and capacity rules as mode commands and execute as one journaled write by the target device's single worker. Their receipts use the same outcomes: `sent` is transport evidence only. A failed or uncertain write holds that device exactly as an uncertain mode write does; the worker's automatic retry never sends it again, and a fresh native request or an explicit mode choice for that device authorizes another attempt. An explicit mode command from any owner cancels that device's queued controls as `stale-generation`. Each device follows the same mode rules, so a Panels scene needs the Panels in Free whatever the Lines' mode is.

| Control | Accepted in | Policy |
| --- | --- | --- |
| `power.set` | Work, Quiet, Free | One write. While desired power is off the worker sends no indicator, restoration or preview writes; task tracking continues. |
| `brightness.set` | Work, Quiet, Free | One write, then the override governs every brightness the worker writes in the current mode: Work indicators and comets, Quiet steady colors, the blue fallback and the remembered scene when it is restored while idle. |
| `scene.activate` | Free only | One selection write through the worker, no polling afterwards. In Work or Quiet it fails typed as `unsupported-capability` before any device write, with a replayable receipt. |

Power and brightness overrides persist until the next explicit mode command, including the same mode, from the CLI, wall map or a native client. That command clears both overrides and reapplies the mode's policy: Work indicators at 30% and the remembered scene at its remembered brightness, Quiet at 10%, Free's existing one-time handoff, and lights on. In Work and Quiet, overrides never change the remembered scene brightness; the scene state records the level the bridge wrote so a later observation does not adopt it as a preference. In Free the bridge does not own the lights, so a brightness set there is an external change and becomes the remembered brightness at the next Work or Quiet observation.

Scene identities are discovered by the worker's existing scene observation in Work and Quiet and stored as opaque IDs, an HMAC of the name under a private ledger secret that no snapshot publishes; the shared snapshot never carries scene names. The [integration extension](integration-api.md) lists the same IDs with the user's Nanoleaf app names. A scene that disappears from the device fails typed as `unsupported-capability`. Snapshots report desired power and brightness as known only while an override is active; observation, external control and service evidence are unchanged and remain unknown without worker evidence.

## State, recovery and limits

Snapshot pending entries describe supported machine mode requests. Private wall layout/reservation patches remain in the wall editor. Relevant browser edits invalidate the public configuration revision; mode choices also retire older queued generations. Mode generation is separate from task pulse/comet epochs.

Successful transmission is `sent`, not evidence of visible light output. Completed transport operation IDs and uncertain operations survive partial failures. A failed/uncertain machine mode is held so that the CLI worker's automatic retry cannot execute that request again. A fresh native request or an explicit CLI, wall-map or native mode choice, including the same mode, authorizes another attempt. Reads and background worker retries do not clear the hold. The worker rechecks the hold after intervening reads and inside the transaction guarding each transport callback, including legacy fallback. Scene/task epochs remain intact.

The last successful machine send survives later failures. Desired mode, pending work and transport outcomes are distinct from device observation. Observation and external ownership are currently unknown because this API does not collect authoritative observation evidence. Its sample clock establishes when the service sampled the snapshot; it does not prove device freshness. On listener restart the sample clock epoch changes and old transmission evidence retains its original epoch.

Snapshots and feed reads never initialize/migrate state, refresh Codex metadata, allocate Lines, reconcile unread state, advance effects, launch a worker or call the device. Each snapshot and feed observation uses one read transaction so its revisions, desired state and pending requests describe the same database state. Read connections wait up to one second for a transient SQLite writer lock; persistent contention remains a failure, without an unbounded retry or a database write. Feed history contains full snapshots from writers. A retained cursor returns later events; the current cursor returns an empty array; invalid, future, expired and foreign cursors return one authoritative resync. Reconnect never submits commands.

Bounds are 65,536 body bytes, JSON depth 32, 32 request threads/admitted requests/pending entries, 256 completed receipts, 32 events and 16 concurrent feed requests. Headers/body have a two-second socket timeout and each HTTP connection has a five-second total budget. Admission uses the remaining connection budget for SQLite lock waits and checks expiry before reservation and commit. Expired uncommitted admission rolls back without consuming a request ID or launching work. Once committed, work remains owned independently of the client connection. Unsent work expires after 30 seconds. The watchdog retries transient SQLite busy/locked errors after its regular half-second wait; expiry and disable checks resume once the writer releases the database. Other maintenance failures stop the listener. A persistent stream is not exposed; clients poll the bounded feed and reauthenticate each request. Slow or excess clients are disconnected/rejected before a new effect.

## Immutable adoption and verification

The vendored archive is `@jimmie-potts/device-contracts` `1.0.0`, API `1.0`, from source `589846bcbe6a4a06ef6aaec9d2952c9f9d58dac3`, published in the private [controller-contracts-v1.0.0 release](https://github.com/jimmie-potts/agent-device-hub/releases/tag/controller-contracts-v1.0.0). Archive SHA-256 is `5e0b30ac92e6e8e1e38d8249b740b565de66e3cc810a04bc6fac23e182e84e87`. The archive, receipt, manifest, schema, fixtures and consumer code remain together under `bridge/vendor/device-contracts-1.0.0/`.

Before import, the bridge verifies the archive checksum, the manifest against that archive, and every manifest-listed file hash. CI consumes these checked-in bytes and needs no sibling checkout, mutable branch fetch or new cross-repository secret. Artifact changes require an explicit new pin and compatible verification.

| Consumer | Supported verification |
| --- | --- |
| Nanoleaf optional API | Python 3.12/3.14 on Linux in Depot CI, pinned jsonschema 4.19.2, all 220 shared cases plus owning HTTP/queue/worker tests. Hosted Windows evidence predates the Depot migration and the Windows retirement |
| Existing bridge | Standard-library startup without controller dependencies; full legacy regression and browser suites |
| Real native client / installed bridge / physical device | Separate acceptance; source tests do not establish these results |

Run `python -m pip install -r requirements-controller.txt`, `python scripts/check.py`, `npm run test:browser`, `npm run check:workflow` and `npm run test:workflow` in an isolated source checkout. Linux installer fixtures in `tests/test_linux_runtime.py` verify packaging. The installation's database holds private machine credentials and request history; keep it private. Rollback stops this installation's listener and restores the previous runtime copy; keep the current database to preserve newer task records. Older code ignores the new controller tables, including another device's `controller_*@<device>` ledger; the Lines' ledger stays in the original tables. An older `controller-revoke` or `controller-disable` therefore does not reach queued Panels work. When the newer runtime returns, the Panels' worker ends such a request as `cancelled` with `forbidden` and holds the Panels, as revocation would, without sending it. Do not use fresh setup/reset for upgrade or rollback.

## Machine integration settings

The [integration settings extension](integration-api.md) exposes existing layout, coverage,
reservations, task-project overrides and saved colors through the protected
controller. It has separate versioned requests and configuration receipts; shared
controller v1 mode commands remain unchanged. Pure reads exclude local titles and
paths. The existing worker applies edits on the installation's native database.
Its one light command, the Free-only [`animation.play`](integration-api.md#requested-animations),
is played by the same worker with transport receipts.
Source delivery does not enable the listener, switch task input or change an installation.
