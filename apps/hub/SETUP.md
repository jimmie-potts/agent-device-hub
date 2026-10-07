# Reversible shared monitoring setup

This is the Linux/WSL source deliverable for [Hub #8](https://github.com/jimmie-potts/agent-device-hub/issues/8). It supplies local SDK operations for a named installation owner. Running these operations against personal files, starting clients or services, moving live state, and operating devices require a separate explicit request. Source checks use disposable private directories and never start a physical worker. [Connect device controllers for B.U.N.N.Y.](#connect-device-controllers-for-bunny) wires installed device controllers into the hub. [Start the runtime at boot](#start-the-runtime-at-boot) keeps the WSL services running without a sign-in.

## Supported evidence

Use Node 24 on Linux, including Linux inside WSL. The package includes `setup`, `setup-authority`, `setup-consumer`, `monitor-hook`, and the existing supervised migration APIs. No native Windows service installer is supplied. The shared contract's Python checks run locally since #827; the Python suites still in CI (observability, events, agent state and lifecycle) run on Python 3.14.

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

The SDK installs one `producer.json` and event-specific commands referring to it. Its absolute private path is the ownership marker; each recorded entry must occur exactly once. Events are SessionStart, UserPromptSubmit, PermissionRequest, Stop, SessionEnd, SubagentStart and SubagentStop, with Interrupt for Codex and PostToolUse and PostToolUseFailure for Claude Code. Re-applying setup on an installed Claude receipt from the earlier seven-event list adds the two tool events and records them in the receipt, keeping the credential; plan, inspection and removal accept that receipt until then. Raw hook metadata passes through the shared allowlist normalizer. Tokens travel only in the authenticated local request. Prompts, transcripts, tool content and private paths are dropped. A colocated setup receipt must match the producer and be installed before emission, including after interrupted writes. The hook enforces a 2.9-second process deadline, an 8 MiB stdin bound, because `PostToolUse` carries the whole tool response, and a single bounded HTTP request. Larger input is dropped silently; the turn-end rule still clears that turn's approval. Invalid, disabled or offline input returns silently with success. The selected executable itself must exist and work; a missing runtime cannot be repaired by a hook that never starts.

`planSetup` and `planRemoval` do not write. Their digests bind the operation to the current settings and receipt. Apply writes durable intent, a disabled producer and the original private backup, confirms a persisted credential grant, edits the reviewed target, then enables only a qualified source. Repeat apply validates existing ownership. Removal disables emission, confirms revocation, and removes exact owned entries from the latest settings. Unrelated additions, removals and trust settings survive. An edited, missing or duplicated owned entry is a conflict, not permission to overwrite it. The backup is evidence, never a whole-file restore instruction.

`inspectSetup` returns only the receipt state, neutral owner/source IDs, qualification and local enabled flag. It makes no network call and does not prove the client executed a hook. `inspectNanoleaf` calls only the owning CLI's read-only `shared-status` and projects source/configured/connection. Neither operation starts devices. Read authenticated hub health separately; `admission: 'fenced'` means mutations remain refused even during consumer readiness checks.

### Select a lifecycle version

The optional `lifecycleVersion` input selects the envelope the hooks send:
absent means 1.0, `"1.1"` adds titles and project names, and `"1.2"` also adds
the Claude Desktop session ID. Any other value is rejected. Select a version
only when the running owner accepts it: Hub 0.4.0 or later for 1.1, and
Hub 0.6.0 or later for 1.2. Producers using a version the owner rejects lose
their events, though the hooks still exit silently with success.

An installed receipt cannot change its version in place; planning it with a
different `lifecycleVersion` fails with `setup-identity-conflict`. To change the
version of an installed producer, for example the Claude Code producer moving
to 1.2:

1. Upgrade the Hub through [Upgrade and roll back the installed Hub](#upgrade-and-roll-back-the-installed-hub).
2. Run `planRemoval` for the current receipt directory, review it, and run
   `removeSetup` with its digest. Revocation is confirmed before the entries go.
3. Run `planSetup` with the same source and target, `lifecycleVersion:"1.2"`
   and a **new** private receipt directory. Review it and run `applySetup` with
   its digest and the Hub authority.
4. Confirm with `inspectSetup` that the new receipt is installed and enabled.
   Then check that a Desktop session's next state-changing lifecycle event shows
   its `hostSessionId` in `/api/monitor/v1/sessions?snapshotVersion=1.3`, and
   that a CLI session shows none. Compare the value with that session's record
   in Claude Desktop's local session store, read by key only as the
   [CHOMPI qualification](../../docs/chompi-controller-qualification.md)
   describes. Record only the IDs, never session content.

Monitoring pauses between steps 2 and 3. Keep the removed receipt for audit.
Personal client settings change only through these reviewed operations; do not
edit a producer file or receipt by hand. To roll back, repeat steps 2 and 3 with
the earlier version before rolling the Hub back. The supervised owner migration's `stageProducer` still accepts only producer
files without a version or with `"1.1"`; finish any owner migration before
selecting 1.2.

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

## Upgrade and roll back the installed Hub

This command implements the [installed runtime contract at contracts 1.2.0](https://github.com/jimmie-potts/agent-device-hub/blob/96710bba52054c381035a6afabe8348d2b9bbd93/docs/install-contract.md).
Before planning, running or checking an installed Hub upgrade or rollback, read
this section and run `plan`. The owner’s standing authority in [AGENTS.md](../../AGENTS.md#runtime-and-migration-boundaries)
covers routine upgrades to the established installation during authorized delivery.
The coordinator reviews the saved plan’s exact target, included changes, baseline,
configuration, outage and recovery against that scope, without requesting approval
again. First adoption, new targets or other effects outside scope need their own
authority. Changed inputs require a new plan and scope assessment; the exact digest
check remains mandatory. The command has no force option.

The pinned contract defines installer mechanics. The current local
[authority policy](../../docs/install-contract.md#8-authority) recognizes standing
authorization without changing its schemas, digest binding or recovery checks.

### Prepare and review the plan

Use a clean, merged checkout of this repository on Linux/WSL, Node 24 from
`.nvmrc`, and the existing installation owner's account. Refresh Git's remote
objects before planning when needed. `plan` reads remote main without fetching or
changing a checkout. A missing object or failed remote lookup is not proof of a
merged target. Prepare the source command with `npm ci` and `npm run build` under
`fnm exec --using=.nvmrc --` from the repository root.

The supported installation has its existing configuration at
`~/.local/share/codex-nanoleaf/shared-monitor/host.json`, its Hub entrypoint at
`~/.local/share/codex-nanoleaf/runtime/hub-gh30`, and the shared Node executable at
`~/.local/share/codex-nanoleaf/runtime/node/bin/node`. The command controls only
`codex-nanoleaf-monitor.service`. An unknown service contract, link layout or
configuration is refused. Other installation layouts need their own reviewed
qualification.

Choose an existing private token file whose credential has Hub `read` scope.
Do not create, print or replace a credential for this operation. Keep plan files
private (mode 0600) and outside tracked source. With the owner's actual values:

```bash
umask 077
fnm exec --using=.nvmrc -- node apps/hub/bin/hub-install.mjs plan main \
  --owner <installation-owner> --token-file /absolute/private/read-token \
  > /absolute/private/hub-upgrade-plan.json
```

`plan` and `status` have no service or installation writes. The saved plan binds
its `digest` to the resolved full target SHA, source comparison, installed program
inventory, configuration files, shared paths, service contract, backup scope and
recovery procedure. Process observations and remote-main freshness remain
separate from those approval inputs. Normal state revisions can advance while the
coordinator reviews the plan.

Review `bound.source.comparison`, the added and removed commits and changed paths, the previous
identity, configuration/protected-path hashes, migration flag and outage/recovery
fields. An unavailable baseline comparison is **unknown**, not an empty change
bundle. Record that gap at the checkpoint and establish the complete target
bundle from trusted source and installation evidence. Do not infer an installed
SHA from a version number or an old issue comment.

A first adoption without trustworthy source provenance uses a verified
`legacy/<content-hash>/` copy of the existing program and dependency closure.
Its source revision stays `unknown`. When a trusted prior release identity receipt
is available, `--baseline-receipt /absolute/private/prior-identity.json` accepts
its release identity only after the existing manifest and complete dependency
inventory verify. This option never supplies provenance for a new target.

### Authorized upgrade

The qualified shared supervisor can add `--deadline <Unix-seconds>` to an
`upgrade` or `rollback`. The native operation requires at least 600 seconds
before entry and again immediately before durable mutation intent, after
staging and compatibility checks. Insufficient reserve refuses before stopping
the service. Once admitted, the existing switch/recovery flow finishes; an
external timeout must not terminate it. Ordinary authorized manual upgrades
keep the same plan/digest procedure without a deadline flag. The owning
[supervisor adapter](../maintenance/README.md#hub-installation-adapter) supplies
this bound and independently verifies receipt, process and health readback.

At the checkpoint, name the installation owner, full target SHA and complete
included changes, installed baseline, configuration, expected monitoring outage,
backup/state scope and recovery route. Account for existing automation resuming
when the Hub restarts and obtain any device authority the selected sequence needs.
The upgrader itself sends no device commands and changes no credentials, hooks,
`host.json`, unit or shared Node executable.

After the plan is reviewed within applicable authority, use the full SHA from
`bound.source.target` and the saved plan’s exact `digest`. `--approve` binds the
operation to that plan; it does not require a new human prompt under standing
authority:

```bash
fnm exec --using=.nvmrc -- node apps/hub/bin/hub-install.mjs upgrade <full-sha> \
  --plan /absolute/private/hub-upgrade-plan.json --approve <plan-digest>
```

The command builds the exact clean merged revision in an isolated checkout,
checks the extracted package and complete file/dependency inventories, and stages
an immutable release before stopping anything. Conflicting bytes at an existing
SHA refuse. Compatibility qualification requires the installer, the previous
release and the target to share the same durable surface: the Hub storage and
automation modules, the agent-state durable validator and stored-state schemas,
every lifecycle module except the listed lifecycle 1.2 module (`v1.2.js`), and
the lifecycle 1.0 and 1.1 schemas. An unclassified package file or a new Hub
SQLite module counts as durable. Reducer, coordination, constants, snapshot
(including the snapshot 1.3 validator), the lifecycle 1.2 module and new
lifecycle schema files pass this check. An edit inside the durable validator or
the lifecycle root module (`index.js`) does not. A synthetic
probe then checks that the agent-state entrypoint still exports the durable
validator, writes state with the target, including session titles, projects and
a known parent, and reopens it with the previous release. A durable-surface
change, a probe failure or a missing file refuses before outage with
`install-rollback-unqualified`; the operation's evidence file records the
qualification reason. A future state-format change needs separate
reviewed qualification. [`compatibility.ts`](src/install/compatibility.ts) classifies
every durable file.

Under its installation lock, the command rechecks approval inputs, persists
validated intent, stops the monitor and verifies process exit. It backs up the
named private state/configuration, switches only the Hub current anchor, starts
the same unit and verifies process/build identity, owner, collector, admission,
served assets, browser protections, launch socket and durable-state preservation.
After initial health succeeds, the command briefly freezes the unit's entire
cgroup while a separate process reads SQLite, then thaws it and repeats health.
This prevents the verifier's read lock from faulting the writer. Planning requires
systemd freeze support and an initially running freezer state. Each freeze/thaw
command or property read has a five-second timeout; the reader is killed after
five seconds. A failed read still attempts thaw. A failed pause, resume or final
health check prevents a success receipt and enters the recovery procedure.
An interrupted updater can leave the unit frozen; inspect its recorded phase and
`FreezerState` before any owner-directed recovery. A systemd stop job thaws the
unit before stopping it.

State evidence requires exact equality while stopped across each program switch.
After restart it accepts supported owner edits and normal retention, checking
commit/revision ordering, unexpired records, acknowledgments and bounded dedup
history. It never restores a backup over newer state. SQLite commit counters are
ordering evidence for the qualified writer, not proof of a user's intent.

Stop/start and health attempts are bounded; a failed stop or backup can leave the
service needing owner inspection. Offline downstream controllers are reported
separately from Hub health.

First adoption retains the original `hub-gh30` at a unique `.prev-op-*` history
path and creates `hub-gh30 -> H/current`, where
`H=~/.local/share/agent-device-hub/hub`. It never moves the shared runtime parent.
Hub releases, verified legacy copies, archives, build evidence, operation receipts
and backups stay under H. Backups and state evidence are private; never publish
or commit them.

Success requires exit zero and a durable, read-back `install-receipt/1.0` receipt
whose semantic validator passes. Its running identity must match the target,
health must be healthy and state-preservation evidence must be present. Read-only
`status` distinguishes the installed selection, service/process evidence and
remote main; an inactive service has no running-build claim. Source tests and
fake service receipts remain separate from this installed acceptance.

### Authorized rollback and re-upgrade

Rollback uses the same exact-plan and authority check. The default target is the previous
recoverable identity recorded by the latest successful operation for the current
selection. It is not chosen by directory age and is never fetched implicitly.
For an explicit full SHA, put that SHA after `plan` and after `rollback` below.

```bash
fnm exec --using=.nvmrc -- node apps/hub/bin/hub-install.mjs plan --rollback \
  --owner <installation-owner> --token-file /absolute/private/read-token \
  > /absolute/private/hub-rollback-plan.json
# Review this exact rollback plan within applicable authority before executing.
fnm exec --using=.nvmrc -- node apps/hub/bin/hub-install.mjs rollback \
  --plan /absolute/private/hub-rollback-plan.json --approve <rollback-plan-digest>
```

Recovery always reopens the **latest** durable state. It never restores an older
database over newer notices, acknowledgments, labels, rules, settings or consumed
events. Legacy health without build metadata uses a newly started process,
executable/entrypoint resolution and served-asset evidence. After rollback,
prepare and review a new upgrade plan within applicable authority for the desired
SHA; do not reuse a plan bound to the baseline that preceded rollback.

For initial installed acceptance, retain the migration/upgrade receipt, a real
rollback receipt and a re-upgrade receipt, with correct running identity,
operational health and preserved newer state. Keep the installation issue open
until that sequence passes. A source-only issue must name its reason and the
installation issue that batches this step.

### Failure, inspection and retention

A candidate health failure attempts one qualified program rollback. A successful
recovery reports `failed-rolled-back` and exits nonzero: the requested upgrade
still failed. Failed stop, backup, interrupted adoption or unverifiable recovery
retain an inspection barrier. Inspect the receipt, phase evidence, current link,
processes, original history and latest state with the named owner. Do not clear a
lock or repeat a migration just because its original process exited.

If final receipt persistence fails, the command returns an attempted
`receipt-finalization-failed` document and, when possible, a private diagnostic
file. The durable receipt may still say `in-progress`. No pruning or automatic
retry follows. Backup restoration is a separate owner-reviewed recovery procedure
that must account for newer writes and possible data loss.

After verified success and durable receipt readback, retention keeps the current
release plus three previous successful releases and protects recovery references.
It never follows another runtime's links or prunes legacy copies, receipts,
backups, original `.prev-*` history or Nanoleaf files. An incomplete retention
result is reported separately; inspect it instead of deleting directories by age.

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

An invalid entry stops startup, and the service log names the cause without paths or values: `hub-start-failed: invalid-endpoint` for a non-loopback endpoint, `hub-start-failed: invalid-controller` for a token that is not 43 base64url characters or a malformed ID, and `hub-start-failed: invalid-configuration` for a duplicate alias or a configuration file that is not owner-only. Restore the backup and restart.

1. Health lists each device. `curl -s -H "Authorization: Bearer $(cat /absolute/private/read-token)" http://127.0.0.1:<hub-port>/api/hub/v1/health` returns a `devices` array with each alias, kind, `controllerId` and `deviceId`. `health` is `unknown` until the hub's first request to that controller.
2. Native snapshots validate. `curl -s -w ' %{http_code}\n' -H "Authorization: Bearer $(cat /absolute/private/read-token)" http://127.0.0.1:<hub-port>/api/controllers/v1/<alias>/snapshot` prints the snapshot followed by `200`, and health then shows `ready` for that alias. Repeat with `.../integration/snapshot`, which the dashboard also loads, for Pixoo and the Nanoleaf Lines. On the v1 snapshot, `502` `incompatible-controller` means the entry's IDs do not match the controller's snapshot. `503` `controller-unavailable` means the hub cannot reach the controller, that Pixoo refused the entry's token on its v1 snapshot, or, on the Pixoo integration snapshot, that `PIXOO_MONITOR_ENABLED=1` is missing. Once step 1 has passed with the same read token, `401` `unauthenticated` means the controller refused the entry's token: Nanoleaf answers this way on both snapshots and Pixoo on its integration snapshot. `403` `forbidden` means the read credential's `devices` list lacks the alias. The Panels' integration snapshot always returns `502` `incompatible-controller` until [#323](https://github.com/jimmie-potts/agent-device-hub/issues/323), even with correct IDs, and marks the Panels `unavailable` until their next v1 read.
3. The launcher session shows the controls. Run the hub's `open` command ([Open B.U.N.N.Y. without typing a token](README.md#open-bunny-without-typing-a-token)), or, with `browserAccess` set, open the bookmark `http://127.0.0.1:8788/` or `http://localhost:8788/` ([Open B.U.N.N.Y. from a bookmark](README.md#open-bunny-from-a-bookmark)). Each component view shows the [general controls](../dashboard/README.md#general-controls) its controller declares.

### Roll back

1. Restore the backup: `cp -p /absolute/private/config.json.before-controllers /absolute/private/config.json`.
2. Revoke each hub principal: `nanoleaf controller-revoke --principal <hub-principal-id>` and, from the Pixoo checkout, `npm run --silent mcp:credentials -- revoke /absolute/private/pixoo-data <hub-principal-id>`.
3. Restart the hub service, then confirm health no longer lists the removed aliases.

### Troubleshooting

- **A registered device shows `unknown` health.** Health reports the last request outcome and never contacts the device itself. The first snapshot read, from the dashboard or the check above, sets `ready` or `unavailable`. A Nanoleaf controller that refuses the entry's token answers `401` `unauthenticated` and leaves health `unknown`; a refused Pixoo token shows as `503` `controller-unavailable` on the v1 snapshot and `401` on the integration snapshot. To replace one device's token, remove only that alias's entry, which keeps the other entries and their tokens:

  ```bash
  node -e '
  const fs = require("node:fs");
  const [config, alias] = process.argv.slice(1);
  const value = JSON.parse(fs.readFileSync(config, "utf8"));
  value.controllers = value.controllers.filter(entry => entry.id !== alias);
  fs.rmSync(config + ".next", {force: true});
  fs.writeFileSync(config + ".next", JSON.stringify(value, null, 2) + "\n", {mode: 0o600, flag: "wx"});
  fs.renameSync(config + ".next", config);
  ' /absolute/private/config.json <alias>
  ```

  Nanoleaf devices share one principal, so remove every alias that uses it, such as both the Lines and the Panels. Then revoke the old principal as in [Roll back](#roll-back), create a new one (Pixoo needs a new principal ID), add the removed entries again and restart. Adding an alias that is still present stops startup with a duplicate `id`.
- **Pixoo is in Monitor but does not present it.** After the Pixoo app starts, or the screen turns off and on, Monitor can be configured without being presented. When the backend starts in device mode, Pixoo resumes a saved Monitor selection by itself if the screen was requested on. Turning the screen on alone never resumes it, and a failed first upload, a retained screen-off request or simulator startup waits for an explicit command. Send it with **Start Monitor** in the Pixoo mode form. The hub never sends one on its own.
- **A controller stopped mid-session.** Its reads fail with `controller-unavailable` and health shows `unavailable` until the controller returns; the next successful read shows `ready` again without a hub restart. A command in flight when it stopped is `uncertain-result`, not proof that nothing happened. Use **Reload current values** before sending again.

## Start the runtime at boot

[ADR 0008](../../docs/decisions/0008-runtime-hosting.md) keeps the runtime in the Ubuntu WSL distribution and starts it at boot ([#356](https://github.com/jimmie-potts/agent-device-hub/issues/356)). The runtime is six systemd user services: `codex-nanoleaf-monitor` (the shared monitor and hub), `codex-nanoleaf-wall`, `codex-nanoleaf-controller`, `codex-nanoleaf-mcp`, `pixoo-playlist-controller` and `agent-device-hub-local-controllers`. They are wanted by the user's `default.target`, so without this section they start only when someone opens a WSL session, and they stop when WSL shuts the distribution down after the last session closes.

Three pieces change that. Linger starts the user's services with the distribution. A `.wslconfig` idle timeout keeps the distribution running after the last session closes. One Windows scheduled task starts the distribution at system startup, before anyone signs in. The task only starts the distribution and exits; it does not hold a session open, because the idle timeout already keeps the distribution running. Nothing here changes a service, its state, its ports or any device, and nothing touches the firewall, router or firmware. It is the only Windows artifact of the hub's hosting; the Nanoleaf project adds none of its own.

Installing these pieces needs the installation owner's explicit request. The commands were written for WSL 2.6.2 with systemd enabled on Windows 11. Check the version with `wsl.exe --version` and systemd with `ps -p 1 -o comm=` inside the distribution, which prints `systemd`. Run Linux commands in the distribution as the user that owns the services, and PowerShell commands as the same Windows user.

### Enable linger

Linger makes systemd start the user's service manager at boot instead of at the first login, so the enabled user services start with the distribution:

```bash
sudo loginctl enable-linger "$USER"
loginctl show-user "$USER" --property=Linger
systemctl --user is-enabled codex-nanoleaf-monitor codex-nanoleaf-wall codex-nanoleaf-controller codex-nanoleaf-mcp pixoo-playlist-controller agent-device-hub-local-controllers
```

The second command prints `Linger=yes`, and the third prints `enabled` six times. Enabling linger does not restart the running services.

### Keep the distribution running when the last session closes

By default WSL shuts a distribution down 15 seconds after its last `wsl.exe` session exits, even while systemd services are running. The `[general]` setting `instanceIdleTimeout=-1` turns that shutdown off. WSL added it in 2.5.4. The separate `[wsl2]` setting `vmIdleTimeout` applies only once no distribution is running, so it keeps its default.

In PowerShell, as the installing user, check whether the file already exists:

```powershell
$wslconfig = Join-Path $env:USERPROFILE '.wslconfig'
Test-Path $wslconfig
```

If it prints `False`, create the file:

```powershell
Set-Content -Path $wslconfig -Value "[general]`r`ninstanceIdleTimeout=-1" -Encoding ascii
Get-Content $wslconfig
```

If it prints `True`, add `instanceIdleTimeout=-1` under the file's `[general]` section in a text editor, adding that section if it is missing, and keep every other line. `Get-Content` should show the line under `[general]`.

WSL reads this file when its virtual machine starts, so the setting takes effect after the next `wsl.exe --shutdown` or Windows restart. It applies to every distribution this Windows user starts, so any distribution, such as Docker Desktop's, keeps running until `wsl.exe --terminate <distribution>`, `wsl.exe --shutdown` or a Windows restart.

### Register the startup task

The task runs at system startup as the installing user, whether or not that user is signed in. It uses the S4U logon type, so Windows stores no password, and it runs without elevation. S4U needs the "Log on as a batch job" right, which members of the local Administrators group have by default. The task calls `C:\Program Files\WSL\wsl.exe` directly, not the `wsl.exe` in `System32`: reports on [microsoft/WSL#9231](https://github.com/microsoft/WSL/issues/9231) found that only this path starts WSL from the non-interactive session a startup task runs in.

Register the task from an elevated PowerShell opened by the installing user. `$user` must name that user; check it before registering:

```powershell
$user = "$env:USERDOMAIN\$env:USERNAME"
$user
$action = New-ScheduledTaskAction -Execute 'C:\Program Files\WSL\wsl.exe' -Argument '--distribution Ubuntu --exec /bin/true'
$trigger = New-ScheduledTaskTrigger -AtStartup
$principal = New-ScheduledTaskPrincipal -UserId $user -LogonType S4U -RunLevel Limited
$settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -ExecutionTimeLimit (New-TimeSpan -Minutes 5)
Register-ScheduledTask -TaskPath '\agent-device-hub\' -TaskName 'Start WSL runtime' -Description 'Starts the Ubuntu distribution at boot so its user services run without a sign-in (hub ADR 0008).' -Action $action -Trigger $trigger -Principal $principal -Settings $settings
```

Read it back:

```powershell
$task = Get-ScheduledTask -TaskPath '\agent-device-hub\' -TaskName 'Start WSL runtime'
$task.Principal | Format-List UserId, LogonType, RunLevel
$task.Actions | Format-List Execute, Arguments
$task.Triggers | Format-List CimClass, Enabled
```

Expect the installing user, `S4U`, `Limited`, the `wsl.exe` path and arguments above, and an `MSFT_TaskBootTrigger`.

### Check the installation

A first check needs no restart. Closing WSL stops the six services and every open WSL session, including agent sessions, so choose a quiet moment. From PowerShell:

```powershell
wsl.exe --shutdown
Start-ScheduledTask -TaskPath '\agent-device-hub\' -TaskName 'Start WSL runtime'
```

`Start-ScheduledTask` returns as soon as the task is queued, and the task then waits while WSL boots the virtual machine and systemd. Wait about a minute, then read the result:

```powershell
Get-ScheduledTaskInfo -TaskPath '\agent-device-hub\' -TaskName 'Start WSL runtime' | Format-List LastRunTime, LastTaskResult
wsl.exe --list --running
```

`LastTaskResult` is `0` once the task has finished; `267009` means it is still running, so read it again a little later. With no WSL session open, `wsl.exe --list --running` still lists `Ubuntu`. Querying the list does not open a session.

The installation trial repeats this across a real restart and a long idle period, and records the results on [#356](https://github.com/jimmie-potts/agent-device-hub/issues/356):

1. **After a Windows restart without signing in.** Restart Windows and wait at least five minutes before signing in, so the timestamps separate clearly. After signing in, read the Windows boot time in PowerShell with `(Get-CimInstance Win32_OperatingSystem).LastBootUpTime`. Then open the first WSL session and run the unit and hub checks below. Each unit is `active`, and its `ActiveEnterTimestamp` falls shortly after the boot time and before the sign-in. A timestamp after the sign-in means the unit started with the session instead, because opening a session also starts the user's services.
2. **After every WSL session has been closed for one hour.** Note the `ActiveEnterTimestamp` values, then close every WSL session: terminals, editor remote windows and agent sessions running in WSL. After an hour, run `wsl.exe --list --running` in PowerShell first; it still lists `Ubuntu`. Then open a WSL session and run the checks again. The units are `active` with unchanged timestamps, which shows they never restarted, and the hub answers.

Unit and hub checks, run in WSL. Use the hub's port and a hub credential with `read` scope, as in [Restart and verify](#restart-and-verify):

```bash
systemctl --user show --property=Id,ActiveState,ActiveEnterTimestamp codex-nanoleaf-monitor codex-nanoleaf-wall codex-nanoleaf-controller codex-nanoleaf-mcp pixoo-playlist-controller agent-device-hub-local-controllers
uptime --since
curl -s -o /dev/null -w '%{http_code}\n' -H "Authorization: Bearer $(cat /absolute/private/read-token)" http://127.0.0.1:<hub-port>/api/hub/v1/health
```

`uptime --since` prints when the WSL virtual machine started, and the health request prints `200`.

[Nanoleaf ADR 0011](https://github.com/jimmie-potts/codex-nanoleaf/blob/main/docs/decisions/0011-runtime-availability-follows-wsl.md) asks for [Nanoleaf #133](https://github.com/jimmie-potts/codex-nanoleaf/issues/133) to be reopened when the services are found stopped while Windows stays up. The hub owns that fix through ADR 0008 and #356, so such observations go on #133 as a comment instead, and it stays closed. The WSL restart ADR 0008 observed on 2026-09-25 is [already recorded there](https://github.com/jimmie-potts/codex-nanoleaf/issues/133#issuecomment-5847762759). If the one-hour check finds the services stopped, record that on #356 and link it from a comment on #133.

### Troubleshooting

- **The distribution is not running after a restart.** Read `Get-ScheduledTaskInfo` as above. A `LastTaskResult` other than `0`, or a task that works with `Start-ScheduledTask` but not at boot, is the evidence to record on #356 before changing anything. Also check that `.wslconfig` still contains the setting; the WSL Settings app rewrites that file.
- **The distribution runs but the services do not.** Check `loginctl show-user "$USER" --property=Linger` and read a unit's log with `journalctl --user -u <unit> -b`.

### Remove it

Removing the pieces returns the runtime to manual start: the services start with the first WSL session and stop when WSL shuts the distribution down. Remove the task first, from an elevated PowerShell:

```powershell
Unregister-ScheduledTask -TaskPath '\agent-device-hub\' -TaskName 'Start WSL runtime' -Confirm:$false
Get-ScheduledTask -TaskPath '\agent-device-hub\' -ErrorAction SilentlyContinue
```

The second command prints nothing. Then delete the `instanceIdleTimeout=-1` line from `.wslconfig`, or delete the file if this procedure created it and nothing else has been added. The default idle shutdown returns after the next `wsl.exe --shutdown` or Windows restart. Finally, in WSL:

```bash
sudo loginctl disable-linger "$USER"
loginctl show-user "$USER" --property=Linger
```

This prints `Linger=no`. The services keep running until the last session closes.
