# Reversible shared monitoring setup

This is the Linux/WSL source deliverable for [Hub #8](https://github.com/jimmie-potts/agent-device-hub/issues/8). It supplies local SDK operations for a named installation owner. Running these operations against personal files, starting clients or services, moving live state, and operating devices require a separate explicit request. Source checks use disposable private directories and never start a physical worker. [Connect device controllers for B.U.N.N.Y.](#connect-device-controllers-for-bunny) wires installed device controllers into the hub.

## Supported evidence

Use Node 24 on Linux, including Linux inside WSL. The package includes `setup`, `setup-authority`, `setup-consumer`, `monitor-hook`, and the existing supervised migration APIs. No native Windows service installer is supplied. Python 3.12 and 3.14 remain the shared contract CI versions.

The [provider inventory](../../docs/provider-qualification.md) recorded Codex CLI 0.153.4 and Claude Code 2.1.236 artifacts on WSL on September 8, 2026. These are historical artifact observations, not installed-hook qualification. Codex Desktop's version and hook path remain unknown. No actual client version is newly qualified by this delivery. Synthetic Codex and Claude JSON inputs prove normalization, privacy and bounded failure behavior only. A future installation owner must record the actual version, execution path, trust review, event coverage and missing-signal behavior before setting `qualified: true`. Otherwise keep it false.

Codex configuration follows the [official hook reference](https://learn.chatgpt.com/docs/hooks). Claude configuration follows its [official reference](https://code.claude.com/docs/en/hooks). The generated commands produce no permission decisions or model context. Preserve managed-only hooks policies and the client's normal trust review. An ignored or untrusted hook is absent evidence, never permission to weaken policy. Missing events leave state uncertain.

## Inspect, plan, apply and remove

Choose exactly one source identity and one active receipt directory for that source. The installation owner inventories existing managed producers across client configuration layers before proceeding. This SDK operates on explicit files; it does not discover or take over other installers' entries. A receipt belongs to one state-owner installation. Retain removed receipts for audit and use a new directory for a later installation.

All receipt directories and immediate configuration parent directories must be owned by the current Linux user with mode 0700. Files must be regular, unlinked, owner-only mode 0600, outside Git and `/mnt`. The target client JSON must already exist, with `{}` permitted. Do not copy secrets into a checkout. The receipt and backup contain private configuration and tokens; never display them in frontend status or commit them. The review plan contains the client's full before/after configuration and is for private owner review only.

Compose these exports in the process that owns the exact running host:

```js
import {planSetup, applySetup, inspectSetup, planRemoval, removeSetup}
  from '@jimmie-potts/hub/setup';
import {hubSetupAuthority} from '@jimmie-potts/hub/setup-authority';

// input contains explicit private paths, source identity and qualification.
// hub is the startHub result; hostConfiguration is its private persisted JSON.
const authority = hubSetupAuthority(hub, hostConfiguration);
const plan = await planSetup(input);
// Privately review plan.before, plan.after, additions and removals.
await applySetup(input, plan.digest, authority);
const status = await inspectSetup(input.directory);
const removal = await planRemoval(input.directory);
// Review the current removal diff separately before executing it.
await removeSetup(input.directory, removal.digest, authority);
```

`input` has `directory`, `target`, `source`, `endpoint`, `node`, `hook`, `owner`, and `qualified`. `source` is the shared provider configuration with neutral `provider`, `client`, `hostId`, `sourceId` and initial `hook: 'SessionStart'`. `endpoint` is the chosen owner's numeric IPv4 loopback URL ending `/api/monitor/v1/events`. `node` is the absolute Linux Node 24 executable; `hook` is the installed package's `bin/monitor-hook.mjs`. `owner` is a neutral installation-owner label. Set `target` to the explicitly selected Codex hooks.json or Claude settings.json. Never infer it from a working directory.

The SDK installs one `producer.json` and event-specific commands referring to it. Its absolute private path is the ownership marker; each recorded entry must occur exactly once. Events are SessionStart, UserPromptSubmit, PermissionRequest, Stop, SessionEnd, SubagentStart and SubagentStop, with Interrupt for Codex. Raw hook metadata passes through the shared allowlist normalizer. Tokens travel only in the authenticated local request. Prompts, transcripts, tool content and private paths are dropped. A colocated setup receipt must match the producer and be installed before emission, including after interrupted writes. The hook enforces a 2.9-second process deadline, a bounded stdin and a single bounded HTTP request. Invalid, disabled or offline input returns silently with success. The selected executable itself must exist and work; a missing runtime cannot be repaired by a hook that never starts.

`planSetup` and `planRemoval` do not write. Their digests bind the operation to the current settings and receipt. Apply writes durable intent, a disabled producer and the original private backup, confirms a persisted credential grant, edits the reviewed target, then enables only a qualified source. Repeat apply validates existing ownership. Removal disables emission, confirms revocation, and removes exact owned entries from the latest settings. Unrelated additions, removals and trust settings survive. An edited, missing or duplicated owned entry is a conflict, not permission to overwrite it. The backup is evidence, never a whole-file restore instruction.

`inspectSetup` returns only the receipt state, neutral owner/source IDs, qualification and local enabled flag. It makes no network call and does not prove the client executed a hook. `inspectNanoleaf` calls only the owning CLI's read-only `shared-status` and projects source/configured/connection. Neither operation starts devices. Read authenticated hub health separately; `admission: 'fenced'` means mutations remain refused even during consumer readiness checks.

## Credentials and Windows invocation

The standalone adapter grants one source-derived principal with ingest scope, persists it in the host configuration, replaces the running credential set and verifies authority. Removal deletes that exact principal and verifies HTTP 401. Other credentials remain intact. Use separate consumer credentials: `read`, plus `control` for a consumer that labels sessions or acknowledges notices. Use separate `read`/`control`/`admin` credentials for migration. Never reuse a device token as a producer token. To create other credentials by hand, and for the grant each route needs, see [Credentials](README.md#credentials) in the hub guide.

For an embedded Pixoo owner, first compute `producerPrincipal(input)` and explicitly provision that ID through Pixoo's owning monitor CLI, `node <monitor-cli.js> add-control <data-directory> <principal>`. Capture the returned bearer privately in a mode-0600 `credentialFile`; do not print it in receipts or logs. Pass that absolute file in the setup input and compose `pixooSetupAuthority({dataDirectory, endpoint, node, managementEntrypoint})`. Its endpoint ends `/api/monitor/v1`. Pixoo's released CLI uses read/control credentials for events. This adapter verifies the digest/scopes and live access; it does not invent an ingest-only Pixoo scope. Removal invokes that same owning CLI's `revoke`, checks its persisted disabled state and verifies HTTP 401. Keep the owning service available until revocation is confirmed.

A Windows Codex client may use the explicit `windowsDistribution` option to generate `commandWindows` with `wsl.exe --distribution ... --exec ...`. All executable/config paths refer to Linux files in that distribution. The producer contacts Linux loopback from Linux; no Windows-to-Linux TCP forwarding is assumed. Construction tests reject Windows expansion/metacharacters. Actual Windows execution, distribution startup latency and trust remain unqualified. Claude's source path here runs inside WSL; do not supply `windowsDistribution` for Claude. Preserve existing Windows hooks and never change firewall, router or host placement implicitly.

## Cutover and rollback

Before an owner move, stop configuration edits, inspect every producer and consumer, and confirm identical owner IDs and consumer policies. Nanoleaf's released shared input requires `{id:'nanoleaf', clearOnNewTurn:true}`. If the current state has a different consumer list or policy, stop for an explicit policy migration owned by that service. Never edit an export or database to make import pass.

1. While the embedded owner still runs, review/remove the old setup and verify revocation. Retain its receipt and backup. This temporarily pauses monitoring and prevents duplicate ingestion.
2. Follow [supervised migration](README.md#supervised-state-owner-migration) to quiesce, export and verify source-process exit. Import into a fresh fenced standalone store. Preserve owner ID, source identities, revision, notices, labels and acknowledgments.
3. In a new private receipt directory, apply a reviewed setup against the fenced destination using its exact live host/configuration. Then `stageProducer` its producer file with the same newly granted endpoint/token. It disables emission while retaining the intended qualified enablement. Never retarget a setup receipt to a different credential or owner behind its back.
4. Stage Pixoo's selected-source file and restart the same supervised simulator or separately authorized installed app. Keep its media, scenes and presentation preferences with its owner. Call `hub.prepareConsumers()` to expose a running read projection while all mutation admission remains fenced.
5. Compose `prepareNanoleaf(command, config, endpoint, ownerId)` with the owning Linux Python CLI and explicit environment. It calls `shared-configure --config`, `shared-preflight`, then `shared-select shared`. Its private config includes version 1, ownerId, consumerId `nanoleaf`, endpoint, tokenFile, clearOnNewTurn true, qualifiedSources and explicit bindings. The owning preflight validates credentials, policy, feed and bindings. Shared selection can start Nanoleaf's designated physical worker, so this step needs installation/device authority. Do not run it during source delivery. Legacy hooks remain installed; the owning bridge suppresses their duplicate ingestion while shared input is selected.
6. Activate with the Pixoo route/managed-owner capability and `{id:'nanoleaf', nanoleaf}` from prepareNanoleaf. Activation rechecks current revision/identities and consumer configuration before opening writes. Release completed route locks. Verify one identified event in both actual consumer projections, then collect separately authorized visible-device receipts.

For legacy Nanoleaf rollback, call `rollbackNanoleaf(command)`. It selects and verifies `legacy` through the owning CLI, preserving the latest legacy configuration. It does not restore a backup hook file or resurrect entries the user removed. Before a state-owner rollback, remove the current setup while its owner can confirm revocation, stop its facade, export the **latest** state, verify that owner's exit, and import into another empty host store. Install a fresh receipt and repeat consumer readiness/activation. The original occupied embedded store is never restarted as an automatic fallback. Pixoo remains a remote facade of the selected fresh host, and Nanoleaf's explicit legacy path is restored when requested.

## Update the current-status package

Hub 0.2.0 bundles agent-state 2.0.0 for [Hub #137](https://github.com/jimmie-potts/agent-device-hub/issues/137).
Lifecycle, snapshot and durable export formats remain 1.0. This update changes
current-turn selection and needs no database reset, new installer or owner move.
Perform these steps only under a separate installed-update request with a named
owner and the actual installation paths.

1. Obtain the new Hub archive, SHA-256 sidecar and source receipt from the
   [Hub 0.2.0 release](https://github.com/jimmie-potts/agent-device-hub/releases/tag/hub-v0.2.0).
   Verify `sha256sum -c jimmie-potts-hub-0.2.0.tgz.sha256` in the download directory.
   The receipt must name the merged source revision and bundled state 2.0.0.
   Keep the prior program artifact and its receipt. Never replace an older release asset.
2. Inventory the existing executable/service, hook command, producer receipt,
   owner/source IDs, consumer policies, credentials and private store location.
   Keep the same values. Do not route a second owner to the store or alter
   Nanoleaf/Pixoo selection or device workers for this code update.
3. Stop the one monitor host through its existing service manager and verify
   process exit. Retain a private consistent backup of its state directory and
   configuration. Include SQLite sidecars where present. Stop concurrent setup
   edits; hooks may fail open while the host is unavailable. Do not delete or
   edit the database, lease/fence records or setup receipts.
4. Replace the program package using the installation's existing mechanism and
   Node 24. Keep hook/service executable paths consistent with the reviewed
   installation. Verify the installed package manifest and bundled state version.
   Run the packaged synthetic `tests/setup-hook.test.mjs` in disposable state
   before exposing the updated host to the existing store.
5. Restart that same owner against the same store. Verify authenticated health,
   owner/source/consumer identity and retained labels/notices/attention. Restored
   sessions should remain uncertain until accepted fresh evidence. A valid start
   for a new known turn must recover old activity/turn ambiguity in place.
6. Under the separate [Pixoo #34](https://github.com/jimmie-potts/divoom-app-upgrade/issues/34)
   acceptance request, record actual Desktop start A, stop A, start B and matching
   identity in the shared feed. Expect active, idle, active and configured notice
   clearing. Provider ordering stays unknown; success and readership remain
   unproven. The named owner records the installed versions, source/hash receipt,
   retained-state checks and real-client observations. Physical display evidence
   has its own authorized sequence.

An unseen delayed start can temporarily select the wrong turn and clear a notice.
Recent retired IDs are protected within the 256-entry FIFO; retained completed
turn notices add protection. Very old evicted IDs and identities absent from an
old export cannot be rejected reliably. This release adds no full event history.

For an authorized program rollback, stop the new owner first, retain the latest
store and reinstall the prior verified program artifact. It can read format 1.0
but restores the older conservative status behavior. A program before Hub 0.3.4
fails closed on a store holding a Claude Code or Codex CLI retirement guard
written by 0.3.4, however old that guard is. A guard expires 24 hours after its
retirement, but only a running or reopened 0.3.4 owner prunes it. Before such a
rollback, keep 0.3.4 running, or reopen it once, at least 24 hours after the
last Claude or CLI retirement, then stop it; otherwise use the export/import
handoff with an explicitly reconciled export. Do not overwrite new notices or acknowledgments with the pre-update
database backup. A failed reopen requires inspection by the installation owner,
not a live database reset.

## Failure recovery and evidence

An apply failure retains an `applying` receipt and disabled producer. Re-plan and retry with the same input/authority after resolving the reported conflict. A removal failure retains `removing` intent; retry after restoring access to the owning service and inspecting the latest removal diff. Never remove the receipt to bypass revocation. If the process died holding `setup.lock`, the named owner must establish that the setup coordinator is gone and no other setup runs, inspect the receipt and affected files, then remove only that empty lock directory before retrying. Unknown owned-entry edits need explicit reconciliation; automatic whole-file recovery is refused.

A failed consumer preflight leaves the old selected path in place. A failure after shared selection requires explicit legacy rollback or completion of the fenced handoff. Failed activation cannot be retried on the same destination capability. Follow the host's staged recovery/export procedure into a fresh store. Keep producer emission disabled or mutation admission fenced throughout recovery. Do not clear a database fence, open a controller database from Hub, or start a second physical writer.

Source evidence consists of setup conflict/recovery tests, silent-hook tests, credential rejection checks, reproducible offline packaging, and `scripts/check-hub-shared-consumers.mjs` against pinned Pixoo/Nanoleaf sources. The latter replaces only physical worker launch with a no-op and uses real owning configuration/preflight/status logic. It verifies the identified event, both projections, revocation, legacy selection and latest-state host rollback. The existing Pixoo host check additionally covers labels/notices/acknowledgment and renderer behavior. These do not establish personal installation, real-client event completeness, integrated performance budgets or optical accuracy. Record each future receipt with its named owner and exact versions; Pixoo #34 and Nanoleaf #30 retain device acceptance.

Credential adapters also retain a private source-principal ownership record in the state owner's directory. Grant and revoke require the same receipt directory and token digest. A second receipt cannot adopt an active source, even with a copy of its token. Confirmed revocation leaves a tombstone; a later reviewed installation may claim that source again. A crash may retain `setup-authority.lock` in the state owner directory or `<target>.setup.lock` beside a client target. These locks serialize credential changes and SDK edits across sources. Recover it under the same dead-coordinator/no-concurrent-writer procedure as `setup.lock`, without deleting the ownership record.

## Connect device controllers for B.U.N.N.Y.

B.U.N.N.Y. commands a device only through a `controllers` entry in the hub configuration. With `"controllers": []` the dashboard has no component to control. This section wires an installed Pixoo or Nanoleaf controller into an installed hub. The configuration fields are described under [Configuration and authority](README.md#configuration-and-authority). Editing the configuration and restarting the hub service needs the installation owner's explicit request. Tidbyt and LIFX devices use the [local controller host](../local-controllers/README.md#register-it-with-the-hub) instead.

Placeholders below are `<...>` or `/absolute/private/...`. Replace them with the owner's actual values. Never commit these values, and never print a token.

### Prerequisites

Each device controller must already be running and serve `/controller/v1` on numeric loopback (`http://127.0.0.1:<port>/controller/v1`):

- **Pixoo:** the backend runs with `PIXOO_MODE=device`, `PIXOO_CONTROLLER_ENABLED=1` and `PIXOO_MONITOR_ENABLED=1`, on `PIXOO_PORT` (default 8787). The monitor flag also serves the Pixoo integration extension that carries B.U.N.N.Y.'s Monitor/Media mode control. See Pixoo's [shared controller API](https://github.com/jimmie-potts/divoom-app-upgrade/blob/main/docs/hub-controller-api.md).
- **Nanoleaf:** the installed controller user service runs `nanoleaf controller-serve` on its fixed port. See Nanoleaf's [local controller API](https://github.com/jimmie-potts/codex-nanoleaf/blob/main/docs/controller-api.md).

You also need the hub's owner-only configuration path, its port, its service unit and a hub credential with `read` scope for the checks below.

### Create a dedicated principal per device

Give the hub its own principal on each controller. Never reuse another client's credential, such as the one Codex MCP uses. Each command prints a new 43-character token once. Write it straight to an owner-only file:

```bash
umask 077
# Nanoleaf, with the installed launcher. Grants read and control.
nanoleaf controller-token --principal <hub-principal-id> > /absolute/private/nanoleaf-hub.token
# Pixoo, from the Pixoo checkout root, with the backend's private data directory. Grants read and control.
npm run --silent mcp:credentials -- add /absolute/private/pixoo-data <hub-principal-id> control > /absolute/private/pixoo-hub.token
```

Check that each token file is not empty (`test -s <file>`); a failed command still creates the file. Use a principal ID that is not already in use. Nanoleaf reissues an existing principal, which replaces that client's credential and cancels its unsent work. Pixoo refuses an existing ID.

### Read the controller and device IDs

The entry's `controllerId` and `deviceId` must equal `identity.controllerId` and `identity.deviceId` in the controller's native snapshot. Read them without printing the token:

```bash
ids='let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const {controllerId,deviceId}=JSON.parse(s).identity;console.log(controllerId,deviceId)})'
# Nanoleaf prints the Lines snapshot; add --device-id <id> for another device, such as the Panels.
nanoleaf controller-status | node -e "$ids"
# Pixoo serves one device.
curl -s -H "Authorization: Bearer $(cat /absolute/private/pixoo-hub.token)" http://127.0.0.1:<pixoo-port>/controller/v1/snapshot | node -e "$ids"
```

Nanoleaf serves each configured device, such as the Lines and the Panels, behind one endpoint and credential. Add one hub entry per device, with the same endpoint and token and that device's `deviceId`. The dashboard shows no controls for the Panels until [#323](https://github.com/jimmie-potts/agent-device-hub/issues/323).

### Add the controller entries

Back up the configuration first. Keep the copy owner-only, outside Git and outside `/mnt`:

```bash
umask 077
cp -p /absolute/private/config.json /absolute/private/config.json.before-controllers
```

Then add one entry per device. `id` is the neutral alias B.U.N.N.Y. and credentials use; `kind` is `pixoo` or `nanoleaf`; `endpoint` is the controller's loopback URL ending `/controller/v1`; `token` is the principal's token. This command copies the token from its file, so it never appears on screen or in shell history:

```bash
node -e '
const fs = require("node:fs");
const [config, entry, tokenFile] = process.argv.slice(1);
const value = JSON.parse(fs.readFileSync(config, "utf8"));
value.controllers.push({...JSON.parse(entry), token: fs.readFileSync(tokenFile, "utf8").trim()});
fs.rmSync(config + ".next", {force: true});
fs.writeFileSync(config + ".next", JSON.stringify(value, null, 2) + "\n", {mode: 0o600, flag: "wx"});
fs.renameSync(config + ".next", config);
' /absolute/private/config.json '{"id":"<alias>","kind":"<pixoo|nanoleaf>","controllerId":"<controllerId>","deviceId":"<deviceId>","endpoint":"http://127.0.0.1:<port>/controller/v1"}' /absolute/private/<device>-hub.token
```

Launcher sessions reach every registered alias. Any configured hub credential that should reach a new device, including the `read` credential for the checks below and an MCP client's credential, needs the alias in its `devices` list (see [Credentials](README.md#credentials)). Delete the token files once the entries are in place; the controller keeps only the digest, and the configuration holds the only copy.

### Restart and verify

Restart the hub service so it reads the new entries:

```bash
systemctl --user restart <hub-unit>
```

An invalid entry, such as a non-loopback endpoint, a token that is not 43 base64url characters or a duplicate alias, stops startup with `hub-start-failed`. Restore the backup and restart.

1. Health lists each device. `curl -s -H "Authorization: Bearer $(cat /absolute/private/read-token)" http://127.0.0.1:<hub-port>/api/hub/v1/health` returns a `devices` array with each alias, kind, `controllerId` and `deviceId`. `health` is `unknown` until the hub's first request to that controller.
2. Native snapshots validate. `curl -s -w ' %{http_code}\n' -H "Authorization: Bearer $(cat /absolute/private/read-token)" http://127.0.0.1:<hub-port>/api/controllers/v1/<alias>/snapshot` prints the snapshot followed by `200`, and health then shows `ready` for that alias. Repeat with `.../integration/snapshot`, which the dashboard also loads, for Pixoo and the Nanoleaf Lines. On the v1 snapshot, `502` `incompatible-controller` means the entry's IDs do not match the controller's snapshot. `503` `controller-unavailable` means the hub cannot reach the controller, that Pixoo refused the entry's token on its v1 snapshot, or, on the Pixoo integration snapshot, that `PIXOO_MONITOR_ENABLED=1` is missing. Once step 1 has passed with the same read token, `401` `unauthenticated` means the controller refused the entry's token: Nanoleaf answers this way on both snapshots and Pixoo on its integration snapshot. The Panels' integration snapshot always returns `502` `incompatible-controller` until [#323](https://github.com/jimmie-potts/agent-device-hub/issues/323), even with correct IDs, and marks the Panels `unavailable` until their next v1 read.
3. The launcher session shows the controls. Run the hub's `open` command ([Open B.U.N.N.Y. without typing a token](README.md#open-bunny-without-typing-a-token)). Each component view shows the [general controls](../dashboard/README.md#general-controls) its controller declares.

### Roll back

1. Restore the backup: `cp -p /absolute/private/config.json.before-controllers /absolute/private/config.json`.
2. Revoke each hub principal: `nanoleaf controller-revoke --principal <hub-principal-id>` and, from the Pixoo checkout, `npm run --silent mcp:credentials -- revoke /absolute/private/pixoo-data <hub-principal-id>`.
3. Restart the hub service, then confirm health no longer lists the removed aliases.

### Troubleshooting

- **A registered device shows `unknown` health.** Health reports the last request outcome and never contacts the device itself. The first snapshot read, from the dashboard or the check above, sets `ready` or `unavailable`. A Nanoleaf controller that refuses the entry's token answers `401` `unauthenticated` and leaves health `unknown`; a refused Pixoo token shows as `503` `controller-unavailable` on the v1 snapshot and `401` on the integration snapshot. To replace a token, restore the backup, create a principal again (Pixoo needs a new principal ID) and add the entry again; running the add step twice for one alias stops startup with a duplicate `id`.
- **Pixoo is in Monitor but does not present it.** After the Pixoo app starts, or the screen turns off and on, Monitor can be configured without being presented. When the backend starts in device mode, Pixoo resumes a saved Monitor selection by itself if the screen was requested on; turning the screen on alone never resumes it, but a failed first upload, a retained screen-off request or simulator startup waits for an explicit command. Send it with **Start Monitor** in the Pixoo mode form. The hub never sends one on its own.
- **A controller stopped mid-session.** Its reads fail with `controller-unavailable` and health shows `unavailable` until the controller returns; the next successful read shows `ready` again without a hub restart. A command in flight when it stopped is `uncertain-result`, not proof that nothing happened. Use **Reload current values** before sending again.
