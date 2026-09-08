# Local controller API

The optional controller API exposes the bridge's existing Work, Quiet and Free modes to local native clients. The Windows worker still owns light updates. Power, brightness, media, zones, scenes and animation preview are explicitly unsupported. Work/Quiet brightness and scene restoration retain their existing policies.

The [protected controller specification](../openspec/specs/protected-controller-api/spec.md) owns the machine behavior. [Issue #28](https://github.com/jimmie-potts/codex-nanoleaf/issues/28) owns delivery scope. Shared monitoring, installation/real-client acceptance and physical previews have separate issues.

## Dependency and activation

Legacy hooks, map, tray and worker startup use the standard library. The listener lazily imports the unchanged shared Python consumer and needs the pinned packages in `requirements-controller.txt`. A disabled machine API does not require those packages.

These are operator commands for a separately authorized Windows installation. Source checkout tests do not run them against personal state. Use the Windows Python runtime already used by the installed bridge:

```powershell
& $python -m pip install -r .\requirements-controller.txt
& $python .\bridge.py controller-configure --controller-id local-controller --device-id wall --source-id local-source
& $python .\bridge.py controller-token --principal local-hub
& $python .\bridge.py controller-serve
```

The token command prints a new opaque credential once. Keep it in the native client's private configuration, separate from its endpoint and target ID. Add `--read-only` when issuing a read credential. Reissuing a principal replaces its previous credential and cancels its unsent work. Up to 32 principals are retained. IDs use 1 through 128 ASCII letters, digits, dots, underscores or hyphens. Existing IDs cannot be redirected through these commands.

`controller-server.json` records the loopback port while the listener runs. `controller-serve --port <port>` selects a fixed loopback port; the default selects an available port. This is an explicit foreground server, not a new automatic sign-in service. Its lifetime is separate from the tray and wall map. A supported upgrade restarts it only if it was already running, preserving a validated explicit port or the default available-port policy. It rebuilds these arguments for this installation and rejects unrecognized listener arguments before stopping processes. A later owner can start it again through the same Windows command.

```powershell
& $python .\bridge.py controller-status
& $python .\bridge.py controller-revoke --principal local-hub
& $python .\bridge.py controller-disable
```

Revocation blocks old credentials before replay lookup and cancels unsent work. Disable stops the listener and cancels pending machine work without deleting legacy tasks or preferences. To restart a disabled listener, explicitly run `controller-serve`. Installed WSL commands forward to Windows before opening configuration/state. They fail without touching state if the Windows runtime is unavailable. Never run a Linux process against the live Windows SQLite database.

## Routes and authentication

Every request requires `Authorization: Bearer <machine credential>` and the exact `Host: 127.0.0.1:<port>`. Browser edit tokens do not qualify. A supplied Origin must match `http://127.0.0.1:<port>`; cross-site Fetch-Metadata is rejected. There is no CORS permission or LAN listener. The owning Windows worker can still reach its privately configured LAN device.

| Request | Response |
| --- | --- |
| `GET /controller/v1/devices` | `{apiVersion:"1.0",devices:[snapshot]}` for the configured authorized device |
| `GET /controller/v1/snapshot?deviceId=<id>` | Shared snapshot |
| `POST /controller/v1/commands` | Shared receipt, or bounded `{failure:{code}}` before admission |
| `GET /controller/v1/feed?deviceId=<id>&epoch=<id>&sequence=<integer>` | Bounded array of shared feed events |

Commands use JSON and the exact shared `Request` schema. Obtain `nextRequestId`, `configurationRevision` and `generation` from a current snapshot. Supply those values as `requestId`, `expectedConfigurationRevision` and `expectedGeneration`, alongside explicit `controllerId`, `deviceId` and `command:{kind:"mode.set",mode:"Work"|"Quiet"|"Free"}`. Unknown fields, raw destinations, fractional/unsafe counters, duplicate JSON keys and non-finite numbers fail validation. Authentication and target scope checks happen before replay.

Admission returns HTTP 202 for queued work. An identical pending request joins its original work; a completed identical request returns its retained receipt with HTTP 200. Different bodies under one ID conflict. Old uncached/foreign IDs expire; future IDs fail ordering. Semantic failures after reservation retain their receipt. Pre-admission capacity rejection consumes no identity. Use the shared error mapping: 400 invalid, 401 unauthenticated, 403 forbidden, 404 unknown target, 409 conflict/order/stale, 410 expired, 422 unsupported, 429 capacity and 503 temporary service/launch failure.

A fulfilled mode that needs no physical work ends as `cancelled`, without failure, with `priorEffects:none` and empty operation arrays. Shared v1 has no separate no-op completion outcome. This result does not claim a transport send.

## State, recovery and limits

Snapshot pending entries describe supported machine mode requests. Private wall layout/reservation patches remain in the wall editor. Relevant browser edits invalidate the public configuration revision; mode choices also retire older queued generations. Mode generation is separate from task pulse/comet epochs.

Successful transmission is `sent`, not evidence of visible light output. Completed transport operation IDs and uncertain operations survive partial failures. A failed/uncertain machine mode is held so that the CLI worker's automatic retry cannot execute that request again. A fresh native request or an explicit tray/CLI mode choice, including the same mode, authorizes another attempt. Reads and background worker retries do not clear the hold. The worker rechecks the hold after intervening reads and inside the transaction guarding each transport callback, including legacy fallback. Scene/task epochs remain intact.

The last successful machine send survives later failures. Desired mode, pending work and transport outcomes are distinct from device observation. Observation and external ownership are currently unknown because this API does not collect authoritative observation evidence. Its sample clock establishes when the service sampled the snapshot; it does not prove device freshness. On listener restart the sample clock epoch changes and old transmission evidence retains its original epoch.

Snapshots and feed reads never initialize/migrate state, refresh Codex metadata, allocate Lines, reconcile unread state, advance effects, launch a worker or call the device. Each snapshot and feed observation uses one read transaction so its revisions, desired state and pending requests describe the same database state. Feed history contains full snapshots from writers. A retained cursor returns later events; the current cursor returns an empty array; invalid, future, expired and foreign cursors return one authoritative resync. Reconnect never submits commands.

Bounds are 65,536 body bytes, JSON depth 32, 32 request threads/admitted requests/pending entries, 256 completed receipts, 32 events and 16 concurrent feed requests. Headers/body have a two-second socket timeout and each HTTP connection has a five-second total budget. Admission uses the remaining connection budget for SQLite lock waits and checks expiry before reservation and commit. Expired uncommitted admission rolls back without consuming a request ID or launching work. Once committed, work remains owned independently of the client connection. Unsent work expires after 30 seconds. The watchdog retries transient SQLite busy/locked errors after its regular half-second wait; expiry and disable checks resume once the writer releases the database. Other maintenance failures stop the listener. A persistent stream is not exposed; clients poll the bounded feed and reauthenticate each request. Slow or excess clients are disconnected/rejected before a new effect.

## Immutable adoption and verification

The vendored archive is `@jimmie-potts/device-contracts` `1.0.0`, API `1.0`, from source `589846bcbe6a4a06ef6aaec9d2952c9f9d58dac3`, published in the private [controller-contracts-v1.0.0 release](https://github.com/jimmie-potts/agent-device-hub/releases/tag/controller-contracts-v1.0.0). Archive SHA-256 is `5e0b30ac92e6e8e1e38d8249b740b565de66e3cc810a04bc6fac23e182e84e87`. The archive, receipt, manifest, schema, fixtures and consumer code remain together under `bridge/vendor/device-contracts-1.0.0/`.

Before import, the bridge verifies the archive checksum, the manifest against that archive, and every manifest-listed file hash. CI consumes these checked-in bytes and needs no sibling checkout, mutable branch fetch or new cross-repository secret. Artifact changes require an explicit new pin and compatible verification.

| Consumer | Supported verification |
| --- | --- |
| Nanoleaf optional API | Python 3.12/3.14 on Windows/Linux, pinned jsonschema 4.19.2, all 220 shared cases plus owning HTTP/queue/worker tests |
| Existing bridge | Standard-library startup without controller dependencies; full legacy regression and browser suites |
| Real native client / installed bridge / physical device | Separate acceptance; source tests do not establish these results |

Run `python -m pip install -r requirements-controller.txt`, `python scripts/check.py`, `npm run test:browser`, `npm run check:workflow` and `npm run test:workflow` in an isolated source checkout. Windows source tooling has a temporary-state fixture in `tests/test_controller_install.ps1`. The normal installer backs up the Windows database, including private machine credentials and request history. Rollback stops this installation's listener and restores backed-up program files; keep the current database to preserve newer task records. Older code ignores the new controller tables. Do not use fresh setup/reset for upgrade or rollback.
